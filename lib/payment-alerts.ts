import "server-only";

export type PaymentRecoveryBacklog = {
  paymentDue: number;
  refundDue: number;
  refundOutstanding: number;
  leased: number;
  blocked: number;
  oldestDueAt: string | null;
};

export type ReconciliationReport = {
  paymentsChecked: number;
  refundsChecked: number;
  refundsPending: number;
  failed: string[];
  budgetExhausted: boolean;
  batchLimitReached: boolean;
  backlog: PaymentRecoveryBacklog | null;
  backlogError: string | null;
};

export type PaymentAlertCode =
  | "recovery_failures"
  | "recovery_backlog"
  | "recovery_stalled"
  | "recovery_blocked"
  | "recovery_work_remaining"
  | "recovery_backlog_unreadable";

export type PaymentAlert = {
  code: PaymentAlertCode;
  severity: "warning" | "critical";
  message: string;
  details: Record<string, number | string | boolean | null>;
};

// Alert when more work is due than a normal day's backlog, or when the oldest
// outstanding item has been waiting longer than a reconciliation cycle should
// ever allow. Values are deliberately conservative so a healthy backlog of a
// few retries stays silent.
export const PAYMENT_ALERT_BACKLOG_THRESHOLD = 50;
export const PAYMENT_ALERT_STALLED_MINUTES = 60;

export function evaluatePaymentAlerts(report: ReconciliationReport, now = Date.now()): PaymentAlert[] {
  const alerts: PaymentAlert[] = [];
  const backlog = report.backlog;

  if (report.failed.length > 0) {
    alerts.push({ code: "recovery_failures", severity: "critical",
      message: `${report.failed.length} payment recovery item(s) failed and need a retry.`,
      details: { failed: report.failed.length, sample: report.failed.slice(0, 5).join(",") } });
  }
  if (backlog) {
    const due = backlog.paymentDue + backlog.refundDue;
    if (due > PAYMENT_ALERT_BACKLOG_THRESHOLD) {
      alerts.push({ code: "recovery_backlog", severity: "warning",
        message: `${due} payment recovery item(s) are due, above the ${PAYMENT_ALERT_BACKLOG_THRESHOLD} item alert threshold.`,
        details: { due, paymentDue: backlog.paymentDue, refundDue: backlog.refundDue, threshold: PAYMENT_ALERT_BACKLOG_THRESHOLD } });
    }
    const oldest = backlog.oldestDueAt ? Date.parse(backlog.oldestDueAt) : Number.NaN;
    if (Number.isFinite(oldest) && now - oldest >= PAYMENT_ALERT_STALLED_MINUTES * 60_000) {
      alerts.push({ code: "recovery_stalled", severity: "warning",
        message: `Payment recovery work has been outstanding for more than ${PAYMENT_ALERT_STALLED_MINUTES} minutes.`,
        details: { oldestDueAt: backlog.oldestDueAt, stalledMinutes: Math.floor((now - oldest) / 60_000) } });
    }
    if (backlog.blocked > 0) {
      alerts.push({ code: "recovery_blocked", severity: "warning",
        message: `${backlog.blocked} payment recovery item(s) failed repeatedly and may need an operator.`,
        details: { blocked: backlog.blocked, refundOutstanding: backlog.refundOutstanding, leased: backlog.leased } });
    }
  }
  if (report.budgetExhausted || report.batchLimitReached) {
    alerts.push({ code: "recovery_work_remaining", severity: "warning",
      message: "Reconciliation stopped before draining the queue; more work is waiting for the next run.",
      details: { budgetExhausted: report.budgetExhausted, batchLimitReached: report.batchLimitReached,
        paymentsChecked: report.paymentsChecked, refundsChecked: report.refundsChecked, refundsPending: report.refundsPending } });
  }
  if (report.backlogError) {
    alerts.push({ code: "recovery_backlog_unreadable", severity: "warning",
      message: "The payment recovery backlog could not be read, so alert thresholds could not be evaluated.",
      details: { backlogError: report.backlogError } });
  }
  return alerts;
}

export function paymentAlertPayload(alerts: PaymentAlert[], report: ReconciliationReport, environment: string) {
  return { source: "brand-anything/payment-recovery", environment, generatedAt: new Date().toISOString(), alerts, report };
}

export type PaymentAlertDelivery = {
  attempted: boolean;
  delivered: boolean;
  reason: "no_alerts" | "no_webhook" | "delivered" | "webhook_rejected" | "webhook_failed";
  status?: number;
};

function describeError(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function deliverPaymentAlerts(
  alerts: PaymentAlert[],
  report: ReconciliationReport,
  options: { environment?: string; webhookUrl?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<PaymentAlertDelivery> {
  if (alerts.length === 0) return { attempted: false, delivered: false, reason: "no_alerts" };
  const environment = options.environment ?? "unknown";
  const payload = paymentAlertPayload(alerts, report, environment);
  for (const alert of alerts) {
    const log = alert.severity === "critical" ? console.error : console.warn;
    log("Payment recovery alert", { environment, ...alert });
  }
  const webhookUrl = options.webhookUrl ?? process.env.PAYMENT_ALERT_WEBHOOK_URL ?? null;
  if (!webhookUrl) return { attempted: false, delivered: false, reason: "no_webhook" };
  const request = options.fetchImpl ?? fetch;
  try {
    const response = await request(webhookUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000),
    });
    return response.ok
      ? { attempted: true, delivered: true, reason: "delivered", status: response.status }
      : { attempted: true, delivered: false, reason: "webhook_rejected", status: response.status };
  } catch (error) {
    console.warn("Payment recovery alert delivery failed", { environment, error: describeError(error) });
    return { attempted: true, delivered: false, reason: "webhook_failed" };
  }
}
