import fs from "node:fs";
import { APP_URL, checker, enterViewer, fixture, launch, output } from "../lib.mjs";
const { results, check, finish } = checker();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = (ms = 800) => page.waitForTimeout(ms);
async function open(file) {
  const n = await page.locator(".tree-model").count();
  await page.setInputFiles(".toolbar input[type=file]", file);
  await page.waitForFunction((k) => document.querySelectorAll(".tree-model").length > k, n, { timeout: 180000 });
  await settle(1500);
}
try {
  await page.goto(APP_URL);
  await enterViewer(page);
  await open(fixture("ifc/Building-Architecture-ifc4.ifc"));
  await open(fixture("ifc/Building-Architecture-ifc4-v2.ifc"));
  await page.locator(".tabs button", { hasText: "Data" }).click();
  await page.waitForSelector("select[aria-label='Old version']", { timeout: 60000 });
  await page.locator("select[aria-label='Old version']").selectOption({ label: "Building-Architecture-ifc4.ifc" });
  await page.locator("select[aria-label='New version']").selectOption({ label: "Building-Architecture-ifc4-v2.ifc" });
  await page.click("button:has-text('Compare')");
  await page.waitForSelector(".compare-chips", { timeout: 60000 });
  await settle(1500);
  const chips = await page.locator(".compare-chips .chip-button").allInnerTexts();
  check("summary: 1 added, 2 changed, 1 removed", chips.join("|") === "1 added|2 changed|1 removed", JSON.stringify(chips));
  const rows = await page.locator(".compare-list .row .label").allInnerTexts();
  check("added: the new cube", rows.some((r) => r.startsWith("new cube") && r.includes("added")));
  check("removed: the sand bedding", rows.some((r) => r.startsWith("sand bedding") && r.includes("removed")));
  check("changed: the revised wall and the kitchen", rows.some((r) => r.includes("(revised)")) && rows.some((r) => r.startsWith("kitchen")), JSON.stringify(rows));

  await page.locator(".compare-list .row .label", { hasText: "(revised)" }).click();
  await settle(1200);
  const wallDiff = await page.locator(".diff-table").innerText();
  check("wall diff shows the name change", wallDiff.includes("Name") && wallDiff.includes("house - outer wall - house right front (revised)"));
  check("wall diff shows NetVolume 1.269 → 1.500", /NetVolume\s+1\.269\s+1\.500/.test(wallDiff), wallDiff.replace(/\s+/g, " ").slice(0, 200));
  check("selecting a change selects the element", (await page.locator(".props").innerText()).includes("(revised)"));
  await page.locator(".compare-list .row .label", { hasText: /^kitchen/ }).click();
  await settle(1200);
  const kitchenDiff = await page.locator(".diff-table").innerText();
  check("kitchen diff: moved 500 mm", /Geometry › Position[\s\S]*moved 500 mm/.test(kitchenDiff), kitchenDiff.replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: output("compare.png") });

  // Colours in the viewer.
  const vis = await page.evaluate(async () => {
    const [v1, v2] = [...window.__bim.models.values()];
    return { v1visible: (await v1.getItemsByVisibility(true)).length, v2hidden: (await v2.getItemsByVisibility(false)).length };
  });
  check("old version shows only the removed element", vis.v1visible === 1, JSON.stringify(vis));

  await page.locator(".compare-chips .chip-button", { hasText: "removed" }).click();
  check("filter chips narrow the list", (await page.locator(".compare-list .row").count()) === 1);
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Export CSV')")]);
  const csv = fs.readFileSync(await download.path(), "utf8").replace(/^﻿/, "").trim().split("\r\n");
  check("CSV lists every change", csv[0].startsWith("Change,GlobalId") && csv.filter((l) => l.startsWith("Added")).length === 1 && csv.filter((l) => l.startsWith("Removed")).length === 1 && csv.filter((l) => l.startsWith("Changed")).length >= 3, `${csv.length - 1} rows`);
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await settle(1000);
  const cleared = await page.evaluate(async () => {
    const [v1] = [...window.__bim.models.values()];
    return (await v1.getItemsByVisibility(false)).length;
  });
  check("clear restores both models", cleared <= 3 && (await page.locator(".compare-chips").count()) === 0, `(v1 hidden ${cleared})`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("ERROR", e.message.split("\n").slice(0, 4).join(" "));
  await page.screenshot({ path: output("compare-error.png") });
  results.push(false);
}
finish();
await browser.close();
