import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const ENV_FILE = ".env.local";
const WEBHOOK_URL = "http://127.0.0.1:3000/api/stripe/webhook";
const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
  "account.updated",
].join(",");

function readEnvironmentFile(path) {
  if (!existsSync(path)) throw new Error(`${path} is missing. Copy .env.example first.`);
  const values = {};
  for (const sourceLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function requireCommand(command, args = ["--version"]) {
  const check = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (check.status !== 0) throw new Error(`${command} is required but could not be run.`);
}

function hideSecrets(text) {
  return text
    .replaceAll(/(?:rk|sk)_test_[A-Za-z0-9]+/g, "[Stripe test key hidden]")
    .replaceAll(/whsec_[A-Za-z0-9]+/g, "[Stripe webhook secret hidden]");
}

function printSafe(chunk) {
  const safe = hideSecrets(String(chunk));
  if (safe.trim()) process.stdout.write(safe);
}

const fileEnvironment = readEnvironmentFile(ENV_FILE);
const stripeKey = fileEnvironment.STRIPE_SECRET_KEY;
if (!stripeKey || !/^(?:rk|sk)_test_/.test(stripeKey)) {
  throw new Error("STRIPE_SECRET_KEY in .env.local must be a Stripe sandbox key (rk_test_ or sk_test_). ");
}
if (fileEnvironment.SUPABASE_DATABASE_PREFIX !== "ba_dev") {
  throw new Error("dev:sandbox refuses to run unless SUPABASE_DATABASE_PREFIX=ba_dev.");
}

requireCommand("stripe");
requireCommand("supabase", ["--version"]);

const migration = spawnSync("supabase", ["migration", "up", "--local"], {
  env: { ...process.env, ...fileEnvironment },
  encoding: "utf8",
  stdio: "pipe",
});
printSafe(migration.stdout);
printSafe(migration.stderr);
if (migration.status !== 0) {
  throw new Error("Local Supabase is not running or its migrations could not be applied. Run `supabase start` first.");
}

const childEnvironment = {
  ...process.env,
  ...fileEnvironment,
  STRIPE_API_KEY: stripeKey,
};
const stripeListener = spawn("stripe", [
  "listen",
  "--skip-update",
  "--events", STRIPE_EVENTS,
  "--forward-to", WEBHOOK_URL,
  "--forward-connect-to", WEBHOOK_URL,
], {
  env: childEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});

let nextProcess;
let listenerOutput = "";
let started = false;
let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  nextProcess?.kill("SIGTERM");
  stripeListener.kill("SIGTERM");
  process.exitCode = exitCode;
}

function startNext(webhookSecret) {
  if (started) return;
  started = true;
  process.stdout.write("Stripe sandbox webhook forwarding is ready (signing secret hidden).\n");
  nextProcess = spawn("npm", ["run", "dev"], {
    env: {
      ...childEnvironment,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
    },
    stdio: "inherit",
  });
  nextProcess.on("exit", (code) => shutdown(code ?? 0));
}

function inspectListenerOutput(chunk) {
  listenerOutput += String(chunk);
  const match = listenerOutput.match(/whsec_[A-Za-z0-9]+/);
  if (match) startNext(match[0]);
  printSafe(chunk);
  if (listenerOutput.length > 16_384) listenerOutput = listenerOutput.slice(-8_192);
}

stripeListener.stdout.on("data", inspectListenerOutput);
stripeListener.stderr.on("data", inspectListenerOutput);
stripeListener.on("exit", (code) => {
  if (!shuttingDown && !started) {
    console.error("Stripe CLI stopped before webhook forwarding was ready. Check the restricted key's Events read permission.");
  }
  shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
