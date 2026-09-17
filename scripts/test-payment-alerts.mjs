import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./lib/load-typescript.mjs";

const {
  PAYMENT_ALERT_BACKLOG_THRESHOLD,
  PAYMENT_ALERT_STALLED_MINUTES,
  deliverPaymentAlerts,
  evaluatePaymentAlerts,
} = loadTypeScript("lib/payment-alerts.ts");

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function report(overrides = {}) {
  return {
    paymentsChecked: 0,
    refundsChecked: 0,
    refundsPending: 0,
    failed: [],
    budgetExhausted: false,
    batchLimitReached: false,
    backlog: { paymentDue: 0, refundDue: 0, refundOutstanding: 0, leased: 0, blocked: 0,
      oldestDueAt: new Date(NOW - 60_000).toISOString() },
    backlogError: null,
    ...overrides,
  };
}

async function quietly(body) {
  const original = { warn: console.warn, error: console.error };
  const calls = { warn: [], error: [] };
  console.warn = (...args) => { calls.warn.push(args); };
  console.error = (...args) => { calls.error.push(args); };
  try { const result = await body(); return { result, calls }; } finally { Object.assign(console, original); }
}

test("a drained, healthy reconciliation run raises no alerts", () => {
  assert.deepEqual(evaluatePaymentAlerts(report(), NOW), []);
});

test("recovery failures and unreadable backlogs alert at the right severity", () => {
  const failures = evaluatePaymentAlerts(report({ failed: ["payment-a", "payment-b"] }), NOW);
  assert.deepEqual(failures.map((alert) => [alert.code, alert.severity]), [["recovery_failures", "critical"]]);
  assert.equal(failures[0].details.failed, 2);

  const unreadable = evaluatePaymentAlerts(report({ backlog: null, backlogError: "reconciliation_failed" }), NOW);
  assert.deepEqual(unreadable.map((alert) => alert.code), ["recovery_backlog_unreadable"]);
  assert.equal(unreadable[0].details.backlogError, "reconciliation_failed");
});

test("backlog, stalled work and blocked items alert exactly at their thresholds", () => {
  const threshold = PAYMENT_ALERT_BACKLOG_THRESHOLD;
  const atThreshold = evaluatePaymentAlerts(report({ backlog: { paymentDue: threshold, refundDue: 0,
    refundOutstanding: 0, leased: 0, blocked: 0, oldestDueAt: new Date(NOW - 60_000).toISOString() } }), NOW);
  assert.deepEqual(atThreshold, [], "a backlog at the threshold stays quiet");
  const overThreshold = evaluatePaymentAlerts(report({ backlog: { paymentDue: threshold - 10, refundDue: 11,
    refundOutstanding: 11, leased: 0, blocked: 0, oldestDueAt: new Date(NOW - 60_000).toISOString() } }), NOW);
  assert.deepEqual(overThreshold.map((alert) => alert.code), ["recovery_backlog"]);
  assert.equal(overThreshold[0].details.due, threshold + 1);

  const fresh = evaluatePaymentAlerts(report(), NOW);
  assert.deepEqual(fresh, [], "recent work is not stalled");
  const stalled = evaluatePaymentAlerts(report({ backlog: { paymentDue: 1, refundDue: 0, refundOutstanding: 0,
    leased: 0, blocked: 0, oldestDueAt: new Date(NOW - PAYMENT_ALERT_STALLED_MINUTES * 60_000).toISOString() } }), NOW);
  assert.deepEqual(stalled.map((alert) => alert.code), ["recovery_stalled"]);
  assert.equal(stalled[0].details.stalledMinutes, PAYMENT_ALERT_STALLED_MINUTES);

  const blocked = evaluatePaymentAlerts(report({ backlog: { paymentDue: 0, refundDue: 0, refundOutstanding: 3,
    leased: 1, blocked: 2, oldestDueAt: new Date(NOW - 60_000).toISOString() } }), NOW);
  assert.deepEqual(blocked.map((alert) => alert.code), ["recovery_blocked"]);
  assert.equal(blocked[0].details.blocked, 2);
});

test("an unfinished batch alerts even when nothing failed", () => {
  for (const overrides of [{ budgetExhausted: true }, { batchLimitReached: true }]) {
    const alerts = evaluatePaymentAlerts(report(overrides), NOW);
    assert.deepEqual(alerts.map((alert) => alert.code), ["recovery_work_remaining"]);
  }
});

test("delivery is silent without alerts and never throws on a failing sink", async () => {
  let fetches = 0;
  const fetchImpl = async () => { fetches++; return new Response("{}", { status: 200 }); };

  const { result: quiet, calls: quietLogs } = await quietly(() =>
    deliverPaymentAlerts([], report(), { webhookUrl: "https://alerts.example.test/hook", fetchImpl }));
  assert.deepEqual(quiet, { attempted: false, delivered: false, reason: "no_alerts" });
  assert.deepEqual(quietLogs, { warn: [], error: [] });

  const { result: unconfigured, calls: unconfiguredLogs } = await quietly(() =>
    deliverPaymentAlerts(evaluatePaymentAlerts(report({ failed: ["payment-a"] }), NOW), report({ failed: ["payment-a"] }),
      { environment: "dev", webhookUrl: null, fetchImpl }));
  assert.deepEqual(unconfigured, { attempted: false, delivered: false, reason: "no_webhook" });
  assert.equal(unconfiguredLogs.error.length, 1, "a critical alert is logged even without a sink");
  assert.equal(fetches, 0, "an unconfigured sink must not be called");

  const alerts = evaluatePaymentAlerts(report({ failed: ["payment-a"] }), NOW);
  const failedReport = report({ failed: ["payment-a"] });
  const originalKey = process.env.PAYMENT_ALERT_WEBHOOK_URL;
  process.env.PAYMENT_ALERT_WEBHOOK_URL = "https://alerts.example.test/hook";
  try {
    const { result: rejected, calls } = await quietly(() => deliverPaymentAlerts(alerts, failedReport,
      { environment: "prod", fetchImpl: async () => new Response("nope", { status: 502 }) }));
    assert.deepEqual(rejected, { attempted: true, delivered: false, reason: "webhook_rejected", status: 502 });
    assert.equal(calls.error.length, 1, "a critical alert is logged even when delivery fails");

    const failing = await quietly(() => deliverPaymentAlerts(alerts, failedReport,
      { environment: "prod", fetchImpl: async () => { throw new Error("socket closed"); } }));
    assert.deepEqual(failing.result, { attempted: true, delivered: false, reason: "webhook_failed" });
    assert.equal(failing.calls.warn.length, 1);

    let captured;
    const { result: delivered } = await quietly(() => deliverPaymentAlerts(alerts, failedReport,
      { environment: "prod", fetchImpl: async (url, init) => { captured = { url, init }; return new Response(null, { status: 204 }); } }));
    assert.deepEqual(delivered, { attempted: true, delivered: true, reason: "delivered", status: 204 });
    assert.equal(captured.url, "https://alerts.example.test/hook");
    assert.equal(captured.init.method, "POST");
    const payload = JSON.parse(captured.init.body);
    assert.equal(payload.source, "brand-anything/payment-recovery");
    assert.equal(payload.environment, "prod");
    assert.equal(payload.alerts[0].code, "recovery_failures");
    assert.equal(payload.report.failed.length, 1);
  } finally {
    if (originalKey === undefined) delete process.env.PAYMENT_ALERT_WEBHOOK_URL;
    else process.env.PAYMENT_ALERT_WEBHOOK_URL = originalKey;
  }
});
