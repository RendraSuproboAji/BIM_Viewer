// Runs the browser end-to-end suites: `npm run e2e` (all) or `npm run e2e -- clash compare`.
// Starts the Vite dev server on :5174 unless E2E_URL points at a running one.
// Suites that need the API start their own on :3001; the others use viewer-only mode.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APP_URL, REPO, schoolModel } from "./lib.mjs";

const VIEWER_SUITES = ["interact", "measure", "stress", "classes", "data", "clash", "compare"];
const API_SUITES = ["db", "issues"];
const TIMEOUT_MS = 20 * 60_000;

const requested = process.argv.slice(2);
const suites = [...VIEWER_SUITES, ...API_SUITES].filter((s) => !requested.length || requested.includes(s));
const unknown = requested.filter((s) => !VIEWER_SUITES.includes(s) && !API_SUITES.includes(s));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(", ")}. Available: ${[...VIEWER_SUITES, ...API_SUITES].join(", ")}`);
  process.exit(2);
}

async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

let vite = null;
if (!process.env.E2E_URL) {
  if (await reachable(APP_URL)) {
    console.log(`Using the dev server already running at ${APP_URL}`);
  } else {
    const port = new URL(APP_URL).port;
    vite = spawn(path.join(REPO, "node_modules", ".bin", "vite"), ["--port", port, "--strictPort"], { cwd: REPO, stdio: "ignore" });
    for (let i = 0; i < 120 && !(await reachable(APP_URL)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await reachable(APP_URL))) throw new Error(`Vite dev server did not start on ${APP_URL}`);
  }
}
if (suites.some((s) => s === "data" || s === "stress")) await schoolModel();

const summary = [];
for (const suite of suites) {
  console.log(`\n===== ${suite}`);
  const started = Date.now();
  // Own process group, so a timeout also kills the suite's browser (and API) instead of orphaning them.
  const child = spawn(process.execPath, [path.join(REPO, "e2e", "suites", `${suite}.mjs`)], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  let tally = "";
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    const m = String(chunk).match(/(\d+)\/(\d+) passed/);
    if (m) tally = m[0];
  });
  const timer = setTimeout(() => {
    console.log(`ERROR ${suite} timed out after ${TIMEOUT_MS / 60_000} min`);
    process.kill(-child.pid, "SIGKILL");
  }, TIMEOUT_MS);
  const code = await new Promise((r) => child.once("exit", (c, signal) => r(signal ? signal : c)));
  clearTimeout(timer);
  summary.push({ suite, ok: code === 0, tally: tally || `exit ${code}`, seconds: Math.round((Date.now() - started) / 1000) });
}

vite?.kill("SIGTERM");
console.log("\n===== summary");
for (const s of summary) console.log(`${s.ok ? "PASS" : "FAIL"} ${s.suite.padEnd(9)} ${s.tally.padEnd(14)} ${s.seconds}s`);
fs.writeFileSync(path.join(REPO, "e2e", ".output", "summary.json"), JSON.stringify(summary, null, 2));
if (summary.some((s) => !s.ok)) process.exitCode = 1;
