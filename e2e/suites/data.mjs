import fs from "node:fs";
import { APP_URL, checker, enterViewer, fixture, launch, output, schoolModel } from "../lib.mjs";
const { results, check, finish } = checker();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = (ms = 800) => page.waitForTimeout(ms);
const num = (s) => Number(String(s).replace(/,/g, ""));

try {
  await page.goto(APP_URL);
  await enterViewer(page);
  await page.setInputFiles(".toolbar input[type=file]", await schoolModel());
  await page.waitForSelector(".tree-model", { timeout: 180000 });
  await settle(2000);
  const canvas = await page.locator(".viewport canvas").screenshot();

  await page.locator(".tabs button", { hasText: "Data" }).click();
  await page.waitForSelector(".legend, select[aria-label='Colour by']", { timeout: 120000 });
  check("Data tab reads the element data", (await page.locator("select[aria-label='Colour by'] option").count()) > 10);

  // ---- Colour by class ----------------------------------------------------------------------------
  await page.locator("select[aria-label='Colour by']").selectOption("Class");
  await page.click("button:has-text('Colour')");
  await page.waitForSelector(".legend .row", { timeout: 60000 });
  await settle(1500);
  const legend = await page.locator(".legend .row").evaluateAll((rows) => rows.map((r) => [r.querySelector(".label").textContent, Number(r.querySelector(".badge").textContent), getComputedStyle(r.querySelector(".swatch")).backgroundColor]));
  const counts = Object.fromEntries(legend.map(([l, c]) => [l, c]));
  check("legend has one entry per class with counts", counts.Reinforcingbar === 619 && counts.Beam === 375 && counts.Slab === 299, JSON.stringify(counts));
  check("each class gets a distinct colour", new Set(legend.map((l) => l[2])).size === legend.length);
  const coloured = await page.locator(".viewport canvas").screenshot();
  check("model is recoloured", Buffer.compare(canvas, coloured) !== 0);
  await page.screenshot({ path: output("data-colour-class.png") });

  // Hide one legend entry → those elements become hidden.
  const hiddenBefore = await page.evaluate(async () => (await [...window.__bim.models.values()][0].getItemsByVisibility(false)).length);
  await page.locator(".legend .row", { hasText: "Beam" }).locator("button").click();
  await settle(800);
  const hiddenAfter = await page.evaluate(async () => (await [...window.__bim.models.values()][0].getItemsByVisibility(false)).length);
  check("hiding a legend entry hides its 375 elements", hiddenAfter - hiddenBefore === 375, `(${hiddenBefore} → ${hiddenAfter})`);

  // Selecting and deselecting keeps the colours.
  await page.locator(".legend .row .label", { hasText: "Column" }).click();
  await settle(1500);
  check("clicking a legend entry selects its elements", (await page.locator(".props").count()) === 1);
  await page.click("text=Clear selection");
  await settle(1000);
  const afterDeselect = await page.evaluate(async () => {
    const m = [...window.__bim.models.values()][0];
    const ids = (await m.getItemsOfCategories([/^IFCCOLUMN$/])).IFCCOLUMN.slice(0, 3);
    const defs = await m.getItemsMaterialDefinition(ids).catch(() => null);
    return defs ? "ok" : "n/a";
  });
  const afterDeselectShot = await page.locator(".viewport canvas").screenshot();
  check("colours survive select + clear selection", Buffer.compare(afterDeselectShot, canvas) !== 0, afterDeselect);

  // ---- Colour by a numeric property, as ranges ----------------------------------------------------
  const volumeKey = await page.locator("select[aria-label='Colour by'] option", { hasText: "Volumen" }).first().getAttribute("value");
  await page.locator("select[aria-label='Colour by']").selectOption(volumeKey);
  await page.click("button:has-text('Colour')");
  await settle(2000);
  const ranges = await page.locator(".legend .row .label").allInnerTexts();
  check("numeric property is coloured in ranges", ranges.filter((r) => / – /.test(r)).length >= 3, JSON.stringify(ranges.slice(0, 4)));
  await page.screenshot({ path: output("data-colour-volume.png") });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await settle(1000);
  const cleared = await page.evaluate(async () => (await [...window.__bim.models.values()][0].getItemsByVisibility(false)).length);
  check("clear removes colours and restores hidden entries", (await page.locator(".legend").count()) === 0 && cleared === hiddenBefore, `(hidden ${cleared})`);

  // ---- Quantity takeoff -----------------------------------------------------------------------------
  await page.click("button:has-text('Open takeoff')");
  await page.waitForSelector(".takeoff-table tbody tr", { timeout: 20000 });
  await page.locator(".takeoff select[aria-label='Group by']").selectOption("Class");
  const volLabel = page.locator(".quantity-list label", { hasText: "Dimensiones › Volumen" });
  if (!(await volLabel.locator("input").isChecked())) await volLabel.locator("input").check();
  await page.waitForFunction(() => ![...document.querySelectorAll(".takeoff-table td.num, .takeoff-table th.num")].some((c) => c.textContent === "…"), null, { timeout: 120000 });
  const table = await page.locator(".takeoff-table").evaluate((t) => ({
    head: [...t.querySelectorAll("thead th")].map((c) => c.textContent),
    rows: [...t.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent)),
    total: [...t.querySelectorAll("tfoot th")].map((c) => c.textContent),
  }));
  const col = (name) => table.head.findIndex((h) => h === name);
  const wall = table.rows.find((r) => r[0] === "Wall");
  const rebar = table.rows.find((r) => r[0] === "Reinforcingbar");
  check("takeoff counts per class", num(rebar[col("Count")]) === 619 && num(wall[col("Count")]) === 6, JSON.stringify(table.head));
  check("total count is the sum of rows", num(table.total[1]) === table.rows.reduce((a, r) => a + num(r[1]), 0), table.total[1]);
  const revitVol = num(wall[col("Volumen")]);
  const geomVol = num(wall[col("Volume (m³)")]);
  check("geometric wall volume matches Revit's Volumen (±5%)", Math.abs(geomVol - revitVol) / revitVol < 0.05, `(Revit ${revitVol} m³ vs geometry ${geomVol} m³)`);
  await page.screenshot({ path: output("data-takeoff.png") });

  // Group by storey.
  await page.locator(".takeoff select[aria-label='Group by']").selectOption("Storey");
  await settle(1500);
  const storeys = await page.locator(".takeoff-table tbody tr td:first-child").allInnerTexts();
  check("group by storey", storeys.some((s) => /Entry Level/.test(s)), JSON.stringify(storeys));

  // CSV export.
  const [download] = await Promise.all([page.waitForEvent("download"), page.click(".takeoff button:has-text('Export CSV')")]);
  const csv = fs.readFileSync(await download.path(), "utf8").replace(/^﻿/, "").trim().split("\r\n");
  check("CSV export has header, rows and total", csv[0].startsWith("Storey,Count") && csv.at(-1).startsWith("Total,") && csv.length === storeys.length + 2, csv[0]);

  // Row click selects the group.
  await page.locator(".takeoff-table tbody tr").first().click();
  await settle(1000);
  await page.keyboard.press("Escape");
  await settle(1000);
  check("clicking a takeoff row selects its elements", (await page.locator(".props").count()) === 1);

  // Second model with standard Qto sets.
  await page.setInputFiles(".toolbar input[type=file]", fixture("ifc/Building-Architecture-ifc4.ifc"));
  await page.waitForFunction(() => document.querySelectorAll(".tree-model").length === 2, null, { timeout: 120000 });
  await settle(2000);
  await page.locator(".tabs button", { hasText: "Data" }).click();
  await page.click("button:has-text('Open takeoff')");
  await page.waitForSelector(".takeoff-table tbody tr", { timeout: 60000 });
  const qto = page.locator(".quantity-list label", { hasText: "Qto_WallBaseQuantities › NetVolume" });
  check("standard Qto quantities are offered", (await qto.count()) === 1);
  await page.keyboard.press("Escape");

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("ERROR", e.message.split("\n")[0]);
  await page.screenshot({ path: output("data-error.png") });
  results.push(false);
}
finish();
await browser.close();
