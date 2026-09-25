import { APP_URL, checker, enterViewer, fixture, inkIn, launch, output, schoolModel } from "../lib.mjs";
const { results, check, finish } = checker();
const browser = await launch();
const errorsOf = (page) => { const e = []; page.on("pageerror", (x) => e.push(x.message)); return e; };
const expandAll = async (page, max = 80) => { for (let i = 0; i < max; i++) { const c = page.locator('.tree button.caret[aria-label="Expand"]'); if (!(await c.count())) break; await c.first().click(); await page.waitForTimeout(80); } };
async function open(file, page) {
  await page.setInputFiles(".toolbar input[type=file]", file);
  await page.waitForSelector(".tree-model", { timeout: 180000 });
  await page.waitForTimeout(1500);
}

try {
  // ---- Architecture model: selection, section, zoom ------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = errorsOf(page);
    await page.goto(APP_URL);
  await enterViewer(page);
    await open(fixture("ifc/Building-Architecture-ifc4.ifc"), page);
    await expandAll(page);
    // Fire many selections synchronously in the page, without waiting between them.
    const fired = await page.evaluate(() => {
      const labels = [...document.querySelectorAll(".tree .row .label")].filter((l) => l.title.includes("#"));
      for (let r = 0; r < 3; r++) for (const l of labels) l.click();
      return labels.length * 3;
    });
    await page.waitForTimeout(5000);
    const highlighted = await page.evaluate(async () => {
      let total = 0;
      for (const m of window.__bim.models.values()) total += (await m.getHighlightItemIds()).length;
      return total;
    });
    check("rapid selection leaves exactly one highlight", highlighted === 1, `(${fired} clicks, highlighted=${highlighted})`);

    await page.click("text=Clear selection");
    await page.click("text=Fit all");
    await page.waitForTimeout(1500);
    const canvas = await page.locator(".viewport canvas").boundingBox();
    const gizmo = { x: canvas.x + canvas.width - 150, y: canvas.y + canvas.height - 150, width: 150, height: 150 };
    const model = { x: canvas.x + 50, y: canvas.y + 50, width: canvas.width - 250, height: canvas.height - 250 };
    const gizmoOff = await inkIn(page, gizmo);
    const modelOff = await inkIn(page, model, 150);
    await page.click("button:has-text('Section')");
    let gizmoWorst = Infinity;
    for (const axis of ["x", "y", "z"]) {
      await page.locator(".toolbar select[aria-label='Section axis']").selectOption(axis);
      for (const offset of ["0.05", "0.5", "0.95"]) {
        for (let flip = 0; flip < 2; flip++) {
          await page.locator("input[type=range]").fill(offset);
          await page.waitForTimeout(500);
          gizmoWorst = Math.min(gizmoWorst, await inkIn(page, gizmo));
          await page.click("button:has-text('Flip')");
        }
      }
    }
    await page.locator(".toolbar select[aria-label='Section axis']").selectOption("y");
    await page.locator("input[type=range]").fill("0.2");
    await page.waitForTimeout(800);
    const modelOn = await inkIn(page, model, 150);
    check("section never clips the axis gizmo", gizmoWorst > gizmoOff * 0.8, `(gizmo ink off=${gizmoOff}, worst with section=${gizmoWorst})`);
    check("section still cuts the model", modelOn < modelOff * 0.95, `(model ink ${modelOff} → ${modelOn})`);
    await page.screenshot({ path: output("stress-section.png") });
    await page.click("button:has-text('Section')");

    await page.locator(".tree .row .label", { hasText: "00 groundfloor" }).click();
    await page.waitForTimeout(1500);
    await page.click("text=Fit all");
    await page.waitForTimeout(1500);
    const before = await page.locator(".viewport canvas").screenshot();
    await page.click("text=Zoom to selection");
    await page.waitForTimeout(1500);
    const after = await page.locator(".viewport canvas").screenshot();
    check("zoom to selection works for a storey", Buffer.compare(before, after) !== 0);

    await page.setInputFiles(".toolbar input[type=file]", fixture("notes.txt"));
    await page.waitForSelector(".toast", { timeout: 5000 });
    check("unsupported file shows a message", (await page.locator(".toast").innerText()).includes("Only .ifc and .frag"));
    check("no page errors (architecture)", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---- Library save: rollback on failure, no duplicate uploads (API mocked) -------------------
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = errorsOf(page);
    const calls = [];
    let failElements = true;
    await page.route((u) => u.pathname.startsWith("/api/"), async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      calls.push(`${req.method()} ${url.pathname}`);
      const id = "11111111-1111-1111-1111-111111111111";
      if (req.method() === "POST" && url.pathname === "/api/models") {
        await new Promise((r) => setTimeout(r, 300));
        return route.fulfill({ status: 201, json: { id, name: "x", fileName: "x.frag", size: 1, elementCount: 0, createdAt: new Date().toISOString() } });
      }
      if (url.pathname === "/api/auth/status") return route.fulfill({ json: { setupRequired: false, user: { id: "u1", email: "a@b.c", name: "Tester", role: "admin", createdAt: "2026-01-01" } } });
      if (url.pathname === "/api/projects") return route.fulfill({ json: [{ id: "p1", name: "Test", role: "owner", createdAt: "2026-01-01" }] });
      if (req.method() === "PUT") return failElements ? route.fulfill({ status: 500, json: { error: "disk full" } }) : route.fulfill({ json: { count: 1 } });
      if (req.method() === "DELETE") return route.fulfill({ status: 204 });
      return route.fulfill({ json: [] });
    });
    await page.goto(APP_URL);
  await enterViewer(page);
    await open(fixture("ifc/Infra-Plumbing-ifc4.ifc"), page);
    await page.locator(".model-row button[title^='Save to library']").click();
    await page.waitForSelector(".toast", { timeout: 30000 });
    check("failed save shows an error", (await page.locator(".toast").innerText()).includes("disk full"));
    check("failed save rolls back the upload", calls.includes("DELETE /api/models/11111111-1111-1111-1111-111111111111"), calls.join(", "));
    check("failed save leaves model unlinked", (await page.locator(".model-row .saved").count()) === 0);

    failElements = false;
    calls.length = 0;
    const save = page.locator(".model-row button[title^='Save to library']");
    await save.click();
    await save.click({ force: true }).catch(() => {});
    await save.click({ force: true }).catch(() => {});
    await page.waitForSelector(".model-row .saved", { timeout: 30000 });
    const uploads = calls.filter((c) => c === "POST /api/models").length;
    check("repeated 💾 clicks upload once", uploads === 1, `(uploads=${uploads})`);
    check("no page errors (library)", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---- IFC setup retry after a failed WASM load ------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    let block = true;
    await page.route("**/web-ifc/*.wasm", (route) => (block ? route.abort() : route.continue()));
    await page.goto(APP_URL);
  await enterViewer(page);
    await page.setInputFiles(".toolbar input[type=file]", fixture("ifc/Building-Hvac-ifc4.ifc"));
    await page.waitForSelector(".toast", { timeout: 60000 });
    check("blocked WASM gives an error", (await page.locator(".toast").innerText()).includes("Could not load"));
    block = false;
    await page.locator(".toast button").click();
    await open(fixture("ifc/Building-Hvac-ifc4.ifc"), page);
    const title = await page.locator(".model-row .label").first().innerText();
    check("IFC loading recovers after the WASM becomes reachable", title === "Building-Hvac-ifc4.ifc", title);
    await page.close();
  }

  // ---- Large model tree (school_str.ifc: 619 rebars in one group) ---------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = errorsOf(page);
    await page.goto(APP_URL);
  await enterViewer(page);
    await open(await schoolModel(), page);
    const t0 = Date.now();
    await expandAll(page, 12);
    const group = page.locator(".tree .row", { hasText: "Reinforcingbar (" }).first();
    if (await group.count()) {
      const caret = group.locator("button.caret");
      if ((await caret.getAttribute("aria-label")) === "Expand") await caret.click();
    }
    await page.waitForSelector("button.more", { timeout: 20000 });
    const expandMs = Date.now() - t0;
    const rows = await page.locator(".tree .row").count();
    const more = await page.locator("button.more").first().innerText();
    check("big groups render in pages", rows < 700 && /Show 200 more/.test(more), `(rows=${rows}, "${more}", ${expandMs} ms)`);
    await page.locator("button.more").first().click();
    await page.waitForTimeout(500);
    check("show more adds rows", (await page.locator(".tree .row").count()) > rows);

    // Visibility toggle on a 619-item group stays fast.
    const t1 = Date.now();
    await group.locator("button.icon").click();
    await page.waitForFunction(() => [...document.querySelectorAll(".tree .row")].some((r) => r.textContent.includes("Reinforcingbar (") && r.querySelector("button.icon")?.textContent === "◌"), null, { timeout: 20000 });
    check("hiding a 619-item group updates the tree quickly", Date.now() - t1 < 5000, `(${Date.now() - t1} ms)`);
    await group.locator("button.icon").click();

    // Collapse everything, then pick in 3D: the tree must reveal the element.
    // Outermost first: collapsing a node removes the carets inside it.
    for (let i = 0; i < 200; i++) {
      const caret = page.locator('.tree button.caret[aria-label="Collapse"]:visible').first();
      if (!(await caret.count())) break;
      await caret.click();
    }
    await page.locator('.model-row button.caret[aria-label="Expand"]').click().catch(() => {});
    await page.click("text=Fit all");
    await page.waitForTimeout(1500);
    // Click a model pixel (bright), not a fixed position: framing depends on the model's extents.
    const cbox = await page.locator(".viewport canvas").boundingBox();
    const shot = await page.locator(".viewport canvas").screenshot();
    const hit = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const pts = [];
      for (let y = 0; y < img.height - 200; y += 4) for (let x = 0; x < img.width - 200; x += 4) {
        const i = (y * img.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 450) pts.push([x, y]);
      }
      return pts[Math.floor(pts.length / 2)];
    }, shot.toString("base64"));
    await page.mouse.click(cbox.x + hit[0], cbox.y + hit[1]);
    await page.waitForSelector(".props", { timeout: 15000 });
    await page.waitForTimeout(1500);
    const selectedVisible = await page.evaluate(() => {
      const row = document.querySelector(".tree .row.selected");
      if (!row) return false;
      const r = row.getBoundingClientRect();
      const panel = row.closest(".panel-body").getBoundingClientRect();
      return r.top >= panel.top && r.bottom <= panel.bottom;
    });
    check("3D pick reveals and scrolls to the element in the tree", selectedVisible);
    await page.screenshot({ path: output("stress-tree.png") });
    check("no page errors (large model)", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }
} catch (e) {
  console.log("ERROR", e.message.split("\n").slice(0, 12).join("\n"));
  results.push(false);
}
finish();
await browser.close();
