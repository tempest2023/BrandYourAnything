import assert from "node:assert/strict";

// UI fault injection only: the app, auction snapshot and model rendering are
// real; intercepted confirmation responses are not evidence of Stripe payments.
export async function paymentNoticeChecks(t, { page, baseUrl, slug, endpoint, model, prefix }) {
  const snapshotResponse = await fetch(endpoint);
  assert.equal(snapshotResponse.status, 200);
  const original = await snapshotResponse.json();
  let visibleSnapshot = original;
  const sessionId = "cs_test_paymentNoticeFixture";
  const requests = [];
  const checkoutCreates = [];
  const trackCreate = (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/bids/checkout")) checkoutCreates.push(request.url());
  };
  page.on("request", trackCreate);
  let respond = async (route) => route.fulfill({ json: { status: "pending" } });
  const matcher = (url) => url.pathname.startsWith("/api/stripe/checkout/");
  await page.route(endpoint, (route) => route.fulfill({ json: visibleSnapshot }));
  await page.route(matcher, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    assert.equal(url.pathname, `/api/stripe/checkout/${sessionId}`);
    assert.equal(url.searchParams.get("auction"), slug);
    assert.equal(route.request().method(), "GET");
    await respond(route);
  });
  const visit = async (payment = "success") => {
    requests.length = 0; visibleSnapshot = original;
    await page.goto(`${baseUrl}/${slug}?source=notice-test&payment=${payment}&session_id=${sessionId}#auction`, { waitUntil: "domcontentloaded" });
  };
  const notice = (state) => page.locator(`.payment-notice--${state}`);
  const expectQuery = (retained) => {
    const url = new URL(page.url());
    assert.equal(url.searchParams.has("payment"), retained);
    assert.equal(url.searchParams.has("session_id"), retained);
    assert.equal(url.searchParams.get("source"), "notice-test");
    assert.equal(url.hash, "#auction");
  };
  try {
    await t.test("cancellation is visible, preserves unrelated URL state and never confirms a Session", async () => {
      await visit("cancelled");
      await notice("cancelled").getByText("Checkout cancelled. No new bid was placed.").waitFor();
      expectQuery(false); assert.equal(requests.length, 0);
      if (model) {
        await page.getByText("Drag to orbit · scroll to zoom", { exact: true }).waitFor();
        assert.equal(await page.locator("canvas").count(), 1);
        assert.equal(await page.locator(".mac-lid").count(), 0);
      } else assert.equal(await page.locator(".mac-lid").count(), 1);
    });
    await t.test("confirming stays visible through pending and applies the accepted snapshot", async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      respond = async (route) => {
        if (requests.length === 1) { await gate; return route.fulfill({ json: { status: "pending" } }); }
        visibleSnapshot = { ...original, campaign: { ...original.campaign, title: "Confirmed snapshot received" } };
        return route.fulfill({ json: { status: "accepted", snapshot: visibleSnapshot } });
      };
      try {
        await visit(); await notice("confirming").waitFor(); expectQuery(true);
        release(); await notice("accepted").waitFor();
        await page.getByRole("heading", { name: "Confirmed snapshot received", exact: true }).waitFor();
        assert.equal(requests.length, 2); expectQuery(false);
        assert.equal(await notice("accepted").getAttribute("role"), "status");
      } finally { release(); }
    });
    await t.test("a pending refund retains its Session and can be checked again without another Checkout", async () => {
      respond = (route) => route.fulfill({ json: { status: requests.length === 1 ? "refund_pending" : "refunded", snapshot: original } });
      await visit(); await notice("refund_pending").waitFor(); expectQuery(true);
      await notice("refund_pending").getByRole("button", { name: "Check payment status again" }).click();
      await notice("refunded").waitFor(); expectQuery(false); assert.equal(requests.length, 2);
      assert.equal(await notice("refunded").getByRole("button").count(), 0);
    });
    await t.test("terminal failure and HTTP rejection retain the Session for an explicit retry", async () => {
      for (const response of [{ json: { status: "failed" } }, { status: 404, json: { error: "Wrong auction" } }]) {
        respond = (route) => route.fulfill(requests.length === 1 ? response : { json: { status: "accepted", snapshot: original } });
        await visit(); await notice("failed").waitFor(); expectQuery(true); assert.equal(requests.length, 1);
        await notice("failed").getByRole("button", { name: "Check payment status again" }).click();
        await notice("accepted").waitFor(); expectQuery(false); assert.equal(requests.length, 2);
      }
    });
    await t.test("network, server, malformed and unknown responses retry before confirmed success", async () => {
      respond = (route) => {
        if (requests.length === 1) return route.abort("failed");
        if (requests.length === 2) return route.fulfill({ status: 503, json: { error: "Retry later" } });
        if (requests.length === 3) return route.fulfill({ contentType: "application/json", body: "{" });
        if (requests.length === 4) return route.fulfill({ json: { status: "unexpected" } });
        return route.fulfill({ json: { status: "accepted", snapshot: original } });
      };
      await visit(); await notice("accepted").waitFor(); expectQuery(false); assert.equal(requests.length, 5);
    });
    await t.test("expired sessions end confirmation, while exhausted pending retries offer a safe recheck", async () => {
      respond = (route) => route.fulfill({ json: { status: "expired" } });
      await visit(); await notice("expired").waitFor(); expectQuery(false); assert.equal(requests.length, 1);
      respond = (route) => route.fulfill({ json: { status: "pending" } });
      await visit(); await notice("failed").waitFor(); expectQuery(true); assert.equal(requests.length, 5);
      await notice("failed").getByRole("button", { name: "Check payment status again" }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/payment-notice-${model ? "model" : "laptop"}-${prefix}.png` });
    });
    assert.equal(checkoutCreates.length, 0, "Confirmation and retry must never create a new Checkout");
  } finally {
    page.off("request", trackCreate);
    await page.unroute(matcher); await page.unroute(endpoint);
    await page.goto(`${baseUrl}/${slug}`, { waitUntil: "domcontentloaded" });
  }
}
