import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import Stripe from "stripe";
import { loadTypeScript } from "./lib/load-typescript.mjs";

const budget = loadTypeScript("lib/payment-work-budget.ts");

test("payment deadlines abort real network headers and stalled bodies without leaking to concurrent requests", { timeout: 10_000 }, async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url.includes("retry")) {
      res.writeHead(520, { "Retry-After": "3600", "Content-Type": "application/json" });
      res.end('{"message":"Temporary failure"}');
      return;
    }
    if (req.url.includes("headers")) return;
    if (req.url.includes("slow")) {
      const timer = setTimeout(() => res.end("ordinary request completed"), 250);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"id":'); // Send headers but never finish the JSON body.
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const originalUrl = process.env.SUPABASE_URL; const originalKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = url; process.env.SUPABASE_SECRET_KEY = "local-test-key";
  const admin = loadTypeScript("lib/supabase-admin.ts", { "@/lib/payment-work-budget": budget });
  try {
    for (const path of ["headers", "body"]) {
      await t.test(`bounds stalled ${path}`, async () => {
        const started = performance.now();
        await assert.rejects(budget.withPaymentWorkBudget(async () => {
          const response = await budget.paymentWorkFetch(`${url}/${path}`);
          await response.text();
        }, 100));
        assert.ok(performance.now() - started < 1000);
      });
    }
    await t.test("Stripe SDK body consumption uses the deadline and does not retry", async () => {
      const stripe = new Stripe("sk_test_local", { host: "127.0.0.1", port: server.address().port,
        protocol: "http", httpClient: Stripe.createFetchHttpClient(budget.paymentWorkFetch), maxNetworkRetries: 2 });
      const before = requests; const started = performance.now();
      await assert.rejects(budget.withPaymentWorkBudget(() => stripe.checkout.sessions.retrieve("cs_test_stall", {}, budget.paymentStripeOptions()), 100));
      assert.equal(requests, before + 1);
      assert.ok(performance.now() - started < 1000);
    });
    await t.test("Supabase SDK body consumption also uses the shared deadline", async () => {
      const before = requests; const started = performance.now();
      const result = await budget.withPaymentWorkBudget(() => admin.getSupabaseAdmin().from("body").select(), 100);
      assert.ok(result.error);
      assert.equal(requests, before + 1);
      assert.ok(performance.now() - started < 1000);
    });
    await t.test("database Retry-After cannot put the worker to sleep past its deadline", async () => {
      const before = requests; const started = performance.now();
      const result = await budget.withPaymentWorkBudget(() => admin.getSupabaseAdmin().from("retry").select(), 100);
      assert.equal(result.status, 520);
      assert.equal(requests, before + 1);
      assert.ok(performance.now() - started < 1000);
    });
    await t.test("concurrent ordinary work and request options remain unchanged", async () => {
      const blocked = assert.rejects(budget.withPaymentWorkBudget(async () => {
        assert.equal(budget.paymentStripeOptions().maxNetworkRetries, 0);
        await (await budget.paymentWorkFetch(`${url}/body`)).text();
      }, 100));
      assert.deepEqual(budget.paymentStripeOptions(), {});
      assert.equal(budget.paymentWorkRemaining(), Infinity);
      const normal = budget.paymentWorkFetch(`${url}/slow`).then((response) => response.text());
      await blocked;
      assert.equal(await normal, "ordinary request completed");
    });
    await t.test("nested recovery cannot extend its parent deadline", async () => {
      await assert.rejects(budget.withPaymentWorkBudget(async () => {
        await delay(30);
        await budget.withPaymentWorkBudget(async () => (await budget.paymentWorkFetch(`${url}/body`)).text(), 5000);
      }, 100));
    });
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalKey;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
