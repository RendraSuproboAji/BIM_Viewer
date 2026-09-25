import { APP_URL, checker, enterViewer, fixture, launch, output } from "../lib.mjs";
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/status of 50[234]/.test(m.text()) && errors.push(m.text()));
const { check, finish } = checker();
const eye = (text) => page.locator(".tree .row", { hasText: text }).first().locator("button.icon").first().innerText();
const expandAll = async () => { for (let i = 0; i < 60; i++) { const c = page.locator('.tree button.caret[aria-label="Expand"]'); if (!(await c.count())) break; await c.first().click(); await page.waitForTimeout(120); } };
const tab = (t) => page.locator(".tabs button", { hasText: t }).click();

await page.goto(APP_URL);
  await enterViewer(page);
await page.setInputFiles(".toolbar input[type=file]", fixture("ifc/Building-Architecture-ifc4.ifc"));
await page.waitForSelector(".tree-model", { timeout: 120000 });
await page.waitForTimeout(1500);
await expandAll();
check("space hidden by default (partly: furniture inside stays)", ["◌", "◐"].includes(await eye("living room")), await eye("living room"));
check("wall visible in tree", (await eye("house right front")) === "👁");

await tab("Classes");
await page.locator("label.row", { hasText: "Wall" }).locator("input").click();
await page.waitForTimeout(800);
await tab("Tree");
await page.waitForTimeout(800);
check("class toggle hides wall in tree", (await eye("house right front")) === "◌");

await page.click("text=Show all");
await page.waitForTimeout(1000);
check("show all: wall visible again", (await eye("house right front")) === "👁");
check("show all: space fully visible", (await eye("living room")) === "👁", await eye("living room"));
await tab("Classes");
await page.waitForTimeout(500);
const unchecked = await page.locator(".discipline input[type=checkbox]:not(:checked)").count();
check("show all: every class checkbox checked", unchecked === 0, `(unchecked=${unchecked})`);
await tab("Tree");

// Storey click must frame its contents (camera moves).
const before = await page.locator(".viewport canvas").screenshot();
await page.locator(".tree .row .label", { hasText: "00 groundfloor" }).click();
await page.waitForTimeout(2500);
const after = await page.locator(".viewport canvas").screenshot();
check("storey click reframes camera", Buffer.compare(before, after) !== 0);
await page.screenshot({ path: output("interact-storey.png") });

await page.locator(".tree .row .label", { hasText: "house right front" }).click();
await page.waitForTimeout(800);
await page.click("text=Isolate");
await page.waitForTimeout(1000);
check("isolate: other wall shown hidden", (await eye("house right back")) === "◌");
check("isolate: selected wall visible", (await eye("house right front")) === "👁");
await page.screenshot({ path: output("interact-isolate.png") });

// Remove + reload same file keeps original name and correct tree labels.
await page.locator(".model-row button[title='Remove model']").click();
await page.waitForTimeout(800);
check("remove: tree empty", (await page.locator(".tree-model").count()) === 0);
await page.setInputFiles(".toolbar input[type=file]", fixture("ifc/Building-Architecture-ifc4.ifc"));
await page.waitForSelector(".tree-model", { timeout: 120000 });
await page.waitForTimeout(1500);
const title = await page.locator(".model-row .label").first().innerText();
check("reload: model name reused", title === "Building-Architecture-ifc4.ifc", title);
await page.locator(".tree .row .label", { hasText: "house right front" }).first().click({ timeout: 5000 }).catch(async () => { await expandAll(); await page.locator(".tree .row .label", { hasText: "house right front" }).first().click(); });
await page.waitForTimeout(1000);
const props = await page.locator(".props").innerText();
check("reload: properties work after reload", props.includes("IFCWALL"));

// Picking should ignore hidden models.
await page.locator(".model-row button[title='Hide model']").click();
await page.waitForTimeout(500);
await page.click("text=Clear selection");
const box = await page.locator(".viewport canvas").boundingBox();
for (const [x, y] of [[0.5, 0.5], [0.7, 0.5], [0.6, 0.45]]) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
await page.waitForTimeout(1500);
check("hidden model is not pickable", (await page.locator(".props").count()) === 0);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
finish();
await browser.close();
