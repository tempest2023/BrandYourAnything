import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export function localStack() {
  const result = spawnSync("npx", ["--no-install", "supabase", "status", "-o", "env"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Start the local Supabase stack before running this test.");
  const values = Object.fromEntries(result.stdout.split("\n").flatMap((line) => {
    const match = line.match(/^([A-Z_]+)=(?:"(.*)"|(.*))$/);
    return match ? [[match[1], match[2] ?? match[3]]] : [];
  }));
  const apiUrl = values.API_URL;
  assert.ok(apiUrl && ["localhost", "127.0.0.1"].includes(new URL(apiUrl).hostname), "Tests require a local database.");
  const secretKey = values.SECRET_KEY || values.SERVICE_ROLE_KEY;
  const publishableKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
  assert.ok(secretKey && publishableKey, "Local Supabase keys unavailable.");
  return { apiUrl, secretKey, publishableKey };
}

export function localAppEnvironment(local, prefix = "ba_dev") {
  assert.ok(["ba_dev", "ba_prod"].includes(prefix));
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    VERCEL_ENV: "development",
    SUPABASE_URL: local.apiUrl,
    SUPABASE_SECRET_KEY: local.secretKey,
    SUPABASE_SERVICE_ROLE_KEY: local.secretKey,
    NEXT_PUBLIC_SUPABASE_URL: local.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.publishableKey,
    SUPABASE_DATABASE_PREFIX: prefix,
    ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1",
    MODEL_UPLOAD_SIGNING_SECRET: "local-management-test-only-signing-key",
    // No payment-network calls in this suite. Real Checkout is tested separately.
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_CONNECT_WEBHOOK_SECRET: "",
  };
}

export async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export async function buildLocalApp(environment) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env: environment, stdio: "inherit" });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "Local test build failed.");
}

export async function startLocalApp(environment) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...environment, NEXT_PUBLIC_SITE_URL: baseUrl }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-16_000); });
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error("Test app exited before startup.");
      try {
        const response = await fetch(`${baseUrl}/manage`, { signal: AbortSignal.timeout(1_000) });
        await response.body?.cancel();
        if (response.ok) return { baseUrl, stop: () => stopProcess(child), logs: () => output };
      } catch { /* The HTTP listener is still starting. */ }
      await delay(250);
    }
    throw new Error("Test app startup timed out.");
  } catch (error) { await stopProcess(child); throw new Error(`${error.message}\n${output}`); }
}
