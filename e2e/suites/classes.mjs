import fs from "node:fs";
import { APP_URL, enterViewer, fixture, launch, output } from "../lib.mjs";

const products = new Set(fs.readFileSync(fixture("all_products.txt"), "utf8").split("\n"));
// Spatial/abstract containers carry no element geometry in these samples.
const NOT_ELEMENTS = /^IFC(PROJECT|SITE|BUILDING|BUILDINGSTOREY|BRIDGE|ROAD|RAILWAY|FACILITY|ANNOTATION|GRID|DISTRIBUTIONPORT|ELEMENTASSEMBLY)$/;
const browser = await launch();
// One context for all files, so the app's modules are cached between pages.
const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const files = fs.readdirSync(fixture("ifc")).sort();
let failures = 0;
function topLevelArgs(body) {
  const out = []; let depth = 0, cur = "", str = false;
  for (const ch of body) {
    if (ch === "'" ) str = !str;
    if (!str && ch === "(") depth++;
    if (!str && ch === ")") depth--;
    if (!str && depth === 0 && ch === ",") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
for (const f of files) {
  const text = fs.readFileSync(fixture(`ifc/${f}`), "utf8");
  const expected = new Set();
  for (const m of text.matchAll(/^#\d+\s*=\s*(IFC[A-Z0-9]+)\((.*)\);\s*$/gm)) {
    // IfcProduct.Representation is the 7th attribute; "$" means no own geometry (e.g. aggregates).
    if (products.has(m[1]) && !NOT_ELEMENTS.test(m[1]) && topLevelArgs(m[2])[6] !== "$") expected.add(m[1]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/status of 50[234]/.test(m.text()) && errors.push(m.text()));
  await page.goto(APP_URL);
  await enterViewer(page);
  await page.setInputFiles(".toolbar input[type=file]", fixture(`ifc/${f}`));
  await page.waitForSelector(".tree-model, .toast", { timeout: 120000 });
  // No toast is the normal case: check before reading, or innerText() waits out its timeout.
  const toast = (await page.locator(".toast").count()) ? await page.locator(".toast").innerText() : null;
  await page.click(".tabs button:has-text(\"Classes\")");
  await page.waitForSelector(".discipline", { timeout: 20000 }).catch(() => {});
  const rows = await page.locator(".discipline label.row").evaluateAll((els) => els.map((e) => e.title));
  const groups = await page.locator(".discipline .model-row .label").allInnerTexts();
  const missing = [...expected].filter((c) => !rows.includes(c));
  const ok = !toast && missing.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${f.padEnd(34)} [${groups.join(", ")}] ${rows.map((r) => r.slice(3)).join(" ")}${missing.length ? "  MISSING: " + missing.join(" ") : ""}${toast ? "  ERROR: " + toast : ""}${errors.length ? "  console: " + errors.slice(0, 2).join(" | ").slice(0, 200) : ""}`);
  if (f.startsWith("mep-") || f.startsWith("Building-Architecture-ifc4.")) await page.screenshot({ path: output(`classes-${f}.png`) });
  await page.close();
}
console.log(`\n${files.length - failures}/${files.length} passed`);
if (failures) process.exitCode = 1;
await browser.close();
