// Shared helpers for the browser end-to-end suites (see e2e/README.md).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The app under test: the Vite dev server (it exposes the window.__bim* test hooks). */
export const APP_URL = process.env.E2E_URL ?? "http://localhost:5174/";
/** Vite proxies /api to this port (vite.config.ts). */
export const API_URL = "http://127.0.0.1:3001";

const FIXTURES = path.join(REPO, "e2e", "fixtures");
const OUTPUT = path.join(REPO, "e2e", ".output");
const CACHE = path.join(REPO, "e2e", ".cache");
fs.mkdirSync(OUTPUT, { recursive: true });

/** Path of a committed fixture, e.g. fixture("ifc/Building-Architecture-ifc4.ifc"). */
export const fixture = (name) => path.join(FIXTURES, name);
/** Path for screenshots and other files a suite writes (gitignored, uploaded by CI). */
export const output = (name) => path.join(OUTPUT, name);

/** ThatOpen's 8 MB school model, downloaded once (MIT, not committed). */
export async function schoolModel() {
  const file = path.join(CACHE, "school_str.ifc");
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  const res = await fetch("https://raw.githubusercontent.com/ThatOpen/engine_components/main/resources/ifc/school_str.ifc");
  if (!res.ok) throw new Error(`school_str.ifc download failed: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Headless Chromium with software WebGL (works without a GPU). */
export function launch() {
  return chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

/** Records PASS/FAIL lines; `finish()` prints the "n/m passed" summary and sets the exit code. */
export function checker() {
  const results = [];
  return {
    results,
    check(name, ok, extra = "") {
      results.push(!!ok);
      console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
    },
    fail(error) {
      results.push(false);
      console.log("ERROR", String(error?.message ?? error).split("\n")[0]);
    },
    finish() {
      const passed = results.filter(Boolean).length;
      console.log(`\n${passed}/${results.length} passed`);
      if (passed !== results.length || !results.length) process.exitCode = 1;
    },
  };
}

/** The app shows a sign-in gate; with no API server running, continue in viewer-only mode. */
export async function enterViewer(page) {
  const offline = page.locator("button:has-text('without the server')");
  await Promise.race([offline.waitFor({ timeout: 20000 }).catch(() => {}), page.waitForSelector(".toolbar", { timeout: 20000 }).catch(() => {})]);
  if (await offline.count()) await offline.click();
  await page.waitForSelector(".toolbar", { timeout: 20000 });
}

/** Counts pixels in a screen region that differ from the viewport background (optionally only bright ones). */
export async function inkIn(page, clip, minBrightness = 0) {
  const buf = await page.screenshot({ clip });
  return page.evaluate(
    async ([b64, minBrightness]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (Math.abs(d[i] - 0x1d) + Math.abs(d[i + 1] - 0x21) + Math.abs(d[i + 2] - 0x26) > 40 && d[i] + d[i + 1] + d[i + 2] >= minBrightness * 3) n++;
      return n;
    },
    [buf.toString("base64"), minBrightness],
  );
}

/** Starts the real API server on :3001 with a fresh data directory. */
export async function startApi(name) {
  try {
    await fetch(`${API_URL}/api/health`);
    throw new Error("port 3001 is already in use; stop the other API server first");
  } catch (e) {
    if (String(e.message).includes("in use")) throw e;
  }
  const dataDir = output(`${name}-data`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  const proc = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    cwd: REPO,
    env: { ...process.env, DATA_DIR: dataDir, PORT: "3001", HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  const api = {
    dataDir,
    proc,
    async stop() {
      if (api.proc.exitCode !== null) return;
      api.proc.kill("SIGTERM");
      await new Promise((r) => api.proc.once("exit", r));
    },
    async restart() {
      await api.stop();
      api.proc = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
        cwd: REPO,
        env: { ...process.env, DATA_DIR: dataDir, PORT: "3001", HOST: "127.0.0.1" },
        stdio: "ignore",
      });
      await waitForApi();
    },
  };
  await waitForApi();
  return api;
}

async function waitForApi() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API_URL}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("API did not start");
}
