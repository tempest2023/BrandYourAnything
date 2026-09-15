import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadPlainModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { preparePublishAttempt } = await loadPlainModule("../lib/publish-attempt.ts");
const recovery = await loadPlainModule("../lib/managed-auctions.ts");

test("publish retries retain the full immutable request without retaining credentials", async () => {
  const form = new FormData();
  form.set("slug", "stable-request");
  form.set("title", "A stable auction");
  const first = await preparePublishAttempt(form, "private-access-token", 7, null, 1_000);
  assert.ok(!JSON.stringify(first).includes("private-access-token"));
  assert.equal(Date.parse(first.closesAt), 1_000 + 7 * 86_400_000);
  const retry = await preparePublishAttempt(form, "private-access-token", 7, JSON.parse(JSON.stringify(first)), 20_000);
  assert.deepEqual(retry, first);
  form.set("title", "Changed auction");
  const changed = await preparePublishAttempt(form, "private-access-token", 7, first, 20_000);
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
  assert.notEqual((await preparePublishAttempt(form, "another-owner", 7, changed)).idempotencyKey, changed.idempotencyKey);
  assert.notEqual((await preparePublishAttempt(form, "private-access-token", 14, changed)).idempotencyKey, changed.idempotencyKey);
});

test("different file contents are distinct even when metadata is unchanged", async () => {
  const form = new FormData();
  form.set("photo", new File(["one"], "logo.png", { type: "image/png" }));
  const first = await preparePublishAttempt(form, "owner", 7, null);
  form.set("photo", new File(["two"], "logo.png", { type: "image/png" }));
  assert.notEqual((await preparePublishAttempt(form, "owner", 7, first)).idempotencyKey, first.idempotencyKey);
});

test("recovery storage preserves legacy keys and never resurrects removed entries", () => {
  const saved = new Map();
  globalThis.window = Object.assign(new EventTarget(), { localStorage: {
    getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key),
  } });
  const legacy = { slug: "legacy_auction", title: "Legacy auction" };
  const code = crypto.randomUUID();
  saved.set("brand-anything-managed-auction", JSON.stringify(legacy));
  saved.set("brand-anything-auction-manager-key", code);
  assert.deepEqual(recovery.loadManagedAuctions(), [{ ...legacy, recoveryCode: code }]);
  recovery.rememberManagedAuction({ slug: "new-auction", title: "New auction", recoveryCode: recovery.generateManagerRecoveryCode() });
  assert.equal(recovery.loadManagedAuctions().length, 2);
  recovery.forgetManagedAuction("legacy_auction");
  recovery.forgetManagedAuction("new-auction");
  assert.deepEqual(recovery.loadManagedAuctions(), []);
  window.localStorage.getItem = () => { throw new Error("Storage blocked"); };
  assert.deepEqual(recovery.loadManagedAuctions(), []);
  delete globalThis.window;
});
