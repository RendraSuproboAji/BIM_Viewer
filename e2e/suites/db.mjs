import fs from "node:fs";
import { API_URL, APP_URL, checker, fixture, launch, output, startApi } from "../lib.mjs";

const { results, check, finish } = checker();
const tab = (page, t) => page.locator(".tabs button", { hasText: t }).click();
const settle = (page, ms = 800) => page.waitForTimeout(ms);

const api = await startApi("db");
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const setupRes = await fetch(`${API_URL}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", name: "Admin", password: "password123" }) });
const token = setupRes.headers.get("set-cookie").match(/bim_session=([^;]+)/)[1];
await context.addCookies([{ name: "bim_session", value: token, url: APP_URL }]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());

try {
  await page.goto(APP_URL);
  await page.waitForSelector(".toolbar", { timeout: 20000 });
  await page.waitForFunction(() => !!document.querySelector(".project-menu select")?.value, null, { timeout: 10000 });
  for (const f of ["Building-Architecture-ifc4.ifc", "Infra-Plumbing-ifc4.ifc"]) {
    await page.setInputFiles(".toolbar input[type=file]", fixture(`ifc/${f}`));
    await page.waitForFunction((n) => document.querySelectorAll(".tree-model").length >= n, f.startsWith("Building") ? 1 : 2, { timeout: 120000 });
  }
  await settle(page, 1500);

  // 1. Save both models to the library.
  for (let i = 0; i < 2; i++) {
    await page.locator(".model-row button[title^='Save to library']").first().click();
    await page.waitForFunction((n) => document.querySelectorAll(".model-row .saved").length >= n, i + 1, { timeout: 60000 });
  }
  check("both models saved to library", (await page.locator(".model-row .saved").count()) === 2);

  await tab(page, "Library");
  await page.waitForSelector(".library .card", { timeout: 10000 });
  const cards = await page.locator(".library section").first().locator(".card").allInnerTexts();
  check("library lists 2 models with element counts", cards.length === 2 && cards.every((c) => /[1-9]\d* elements/.test(c)), JSON.stringify(cards.map((c) => c.split("\n")[1])));

  // 2. Search extracted BIM data by property value and class.
  await page.fill(".search-form input", "sewer");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/elements?") && r.url().includes("q=sewer")),
    page.click(".search-form button"),
  ]);
  await settle(page, 500);
  const summary = await page.locator(".library .muted.small", { hasText: "result" }).innerText();
  check("search finds sewer elements", /^\d+ results?$/.test(summary) && !summary.startsWith("0"), summary);
  await page.locator(".row.result", { hasText: "sewer pipe" }).first().click();
  await page.waitForSelector(".props", { timeout: 15000 });
  await settle(page);
  check("clicking a result selects the element", (await page.locator(".props").innerText()).includes("IFCPIPESEGMENT"));

  const byProp = await page.evaluate(async () => (await (await fetch(`/api/elements?projectId=${document.querySelector(".project-menu select").value}&q=SOLIDWALL`)).json()).total);
  check("search matches property/type values", byProp > 0, `(SOLIDWALL → ${byProp})`);

  // 4. Save a view with a section cut.
  await page.click("text=Clear selection").catch(() => {});
  await page.click("button:has-text('Section')");
  await page.locator("input[type=range]").fill("0.3");
  await settle(page);
  await tab(page, "Library");
  await page.fill(".inline-form input", "Ground floor cut");
  await page.click("button:has-text('Save view')");
  await page.waitForSelector(".library .row .label:has-text('Ground floor cut')", { timeout: 10000 });
  check("view saved", true);

  // 5. CSV export.
  const csvUrl = await page.locator(".library a.button").first().getAttribute("href");
  const csv = await page.evaluate(async (u) => (await fetch(u)).text(), csvUrl);
  const header = csv.replace(/^﻿/, "").split("\r\n")[0];
  check("CSV export has element + property columns", header.startsWith("LocalId,GlobalId,Class,Name,Storey") && header.split(",").length > 5, header.slice(0, 120));

  // 6. Restart the API server and reload the page: everything must come back from SQLite.
  await api.restart();
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector(".project-menu select")?.value, null, { timeout: 15000 });
  await tab(page, "Library");
  await page.waitForSelector(".library .card", { timeout: 15000 });
  check("models persisted across server restart", (await page.locator(".library section").first().locator(".card").count()) === 2);
  await page.locator(".library .row .label", { hasText: "Ground floor cut" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".tree-model").length === 2, null, { timeout: 120000 });
  await settle(page, 2500);
  check("view restore reopens both models from library", (await page.locator(".model-row .saved").count()) === 2);
  check("view restore re-applies section", (await page.locator("button.active", { hasText: "Section" }).count()) === 1 && (await page.locator("input[type=range]").inputValue()) === "0.3");
  await page.screenshot({ path: output("db-view-restored.png") });

  // 7. Delete a model: its notes and elements go too.
  await tab(page, "Library");
  const archCard = page.locator(".library .card", { hasText: "Building-Architecture" });
  await archCard.locator("button", { hasText: "Delete" }).click();
  await settle(page, 1000);
  const after = await page.evaluate(async () => {
    const projectId = document.querySelector(".project-menu select").value;
    return { models: (await (await fetch(`/api/models?projectId=${projectId}`)).json()).length };
  });
  check("delete removes the model", after.models === 1, JSON.stringify(after));
  check("sqlite file exists on disk", fs.existsSync(`${api.dataDir}/bim.sqlite`) && fs.readdirSync(`${api.dataDir}/models`).length === 1);
} catch (e) {
  console.log("ERROR", e.message.split("\n")[0]);
  await page.screenshot({ path: output("db-error.png") });
  results.push(false);
} finally {
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));
  finish();
  await browser.close();
  await api.stop();
}
