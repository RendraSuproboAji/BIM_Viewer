import { APP_URL, checker, enterViewer, fixture, launch, output } from "../lib.mjs";
const { results, check, finish } = checker();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = (ms = 800) => page.waitForTimeout(ms);
async function open(file) {
  const n = await page.locator(".tree-model").count();
  await page.setInputFiles(".toolbar input[type=file]", file);
  await page.waitForFunction((k) => document.querySelectorAll(".tree-model").length > k, n, { timeout: 180000 });
  await settle(1500);
}
async function run(mode, mm) {
  await page.locator("select[aria-label='Clash type']").selectOption(mode);
  await page.fill("input[aria-label='Tolerance in mm']", String(mm));
  const before = await page.evaluate(() => document.querySelector("[data-run-id]")?.getAttribute("data-run-id") ?? "0");
  await page.click(".library button:has-text('Run')");
  await page.waitForFunction((b) => (document.querySelector("[data-run-id]")?.getAttribute("data-run-id") ?? "0") !== b && !document.querySelector(".overlay"), before, { timeout: 300000 });
  await settle(500);
  return page.locator(".clash-row .label").allInnerTexts();
}

try {
  await page.goto(APP_URL);
  await enterViewer(page);
  await open(fixture("extra/box.ifc"));
  await open(fixture("extra/mep-pipes.ifc"));
  await page.locator(".tabs button", { hasText: "Clash" }).click();

  const hard = await run("hard", 10);
  check("hard clash: only the pipe through the box", hard.length === 1 && hard[0].includes("Pipe through box") && hard[0].includes("Test box"), JSON.stringify(hard));
  const clearance = await run("clearance", 50);
  check("clearance 50 mm: through (0 mm) and the 30 mm pipe", clearance.length === 2 && clearance.some((c) => /Pipe 30 mm from box.*· 3[012] mm/.test(c)), JSON.stringify(clearance));
  const clearance20 = await run("clearance", 20);
  check("clearance 20 mm: the 30 mm pipe drops out", clearance20.length === 1, JSON.stringify(clearance20));

  // Focusing a clash isolates the pair.
  await run("hard", 10);
  await page.locator(".clash-row .label").first().click();
  await settle(2000);
  const visible = await page.evaluate(async () => {
    let n = 0;
    for (const m of window.__bim.models.values()) n += (await m.getItemsByVisibility(true)).length;
    return n;
  });
  const idsWithGeometry = await page.evaluate(async () => {
    let n = 0;
    for (const m of window.__bim.models.values()) n += (await m.getItemsIdsWithGeometry()).length;
    return n;
  });
  check("focusing a clash isolates the two elements", visible === 2 && (await page.locator(".props").innerText()).includes("Test box"), `(visible items ${visible} of ${idsWithGeometry})`);
  // Re-running from a focused clash must test everything again, not just the two isolated elements.
  const rerun = await run("clearance", 50);
  check("re-running while a clash is focused restores the view first", rerun.length === 2, JSON.stringify(rerun));
  await settle(500);
  await page.locator(".clash-row .label").first().click();
  await page.waitForSelector(".clash-row.selected", { timeout: 5000 });
  await settle(1500);
  await page.screenshot({ path: output("clash-focus.png") });
  await page.click(".library button:has-text('Show all')");
  await settle(800);

  // Real models: buildingSMART architecture + HVAC sample (same scene).
  await page.locator(".tabs button", { hasText: "Tree" }).click();
  await page.locator(".model-row button[title='Remove model']").first().click();
  await page.locator(".model-row button[title='Remove model']").first().click();
  await settle(800);
  await open(fixture("ifc/Building-Architecture-ifc4.ifc"));
  await open(fixture("ifc/Building-Hvac-ifc4.ifc"));
  await page.locator(".tabs button", { hasText: "Clash" }).click();
  const real = await run("hard", 10);
  const meta = await page.locator(".library section h3 + p").last().innerText();
  console.log("   real models:", real.length, "clashes;", meta);
  real.slice(0, 6).forEach((r) => console.log("     ", r.replace(/\s+/g, " ")));
  check("runs on real models and reports the timing", /pairs tested in [\d.]+ s/.test(meta));
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("ERROR", e.message.split("\n").slice(0, 14).join("\n"));
  await page.screenshot({ path: output("clash-error.png") });
  results.push(false);
}
finish();
await browser.close();
