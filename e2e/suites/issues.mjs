import fs from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { APP_URL, checker, fixture, launch, output, startApi } from "../lib.mjs";

const { results, check, finish } = checker();
const settle = (page, ms = 800) => page.waitForTimeout(ms);
const tab = (page, t) => page.locator(".tabs button", { hasText: t }).first().click();
async function openModel(page, file) {
  const before = await page.locator(".tree-model").count();
  await page.setInputFiles(".toolbar input[type=file]", file);
  await page.waitForFunction((n) => document.querySelectorAll(".tree-model").length > n, before, { timeout: 120000 });
  await page.waitForFunction(() => window.__bimControls && !window.__bimControls.active, null, { timeout: 15000 });
  await settle(page, 800);
}
const camera = (page) => page.evaluate(() => { const c = window.__bimControls; return { pos: c.camera.position.toArray(), target: c.getTarget(c.camera.position.clone()).toArray() }; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const api = await startApi("issues");
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

try {
  // ---- First run: setup screen creates the admin ----------------------------------------------------
  await page.goto(APP_URL);
  await page.waitForSelector(".auth-card", { timeout: 20000 });
  check("first run shows the setup screen", (await page.locator(".auth-card h1").innerText()) === "Welcome");
  await page.fill("input[autocomplete=username]", "admin@example.com");
  await page.locator(".auth-form input").first().fill("Ada Admin");
  const pw1 = page.locator("input[autocomplete=new-password]");
  await pw1.nth(0).fill("correct horse");
  await pw1.nth(1).fill("correct horse");
  await page.click("button:has-text('Create administrator')");
  await page.waitForSelector(".toolbar", { timeout: 20000 });
  check("admin lands in the app with the default project", (await page.locator(".project-menu select option:checked").innerText()) === "Default project");

  // ---- Users and projects -----------------------------------------------------------------------------
  await page.click(".project-menu button");
  await page.locator(".modal .tabs button", { hasText: "Users" }).click();
  await page.fill(".grid-form input[aria-label=Name]", "Bob Client");
  await page.fill(".grid-form input[aria-label=E-mail]", "bob@example.com");
  await page.fill(".grid-form input[aria-label='Initial password']", "password123");
  check("new users default to the least-privileged role", (await page.locator(".grid-form select[aria-label=Role]").inputValue()) === "client");
  await page.locator(".grid-form select[aria-label=Role]").selectOption("client");
  await page.click(".grid-form button");
  await settle(page);
  check("admin creates a client", (await page.locator(".modal .grid-table").innerText()).includes("bob@example.com") &&
    (await page.locator(".modal select[aria-label='Role of Bob Client']").inputValue()) === "client");
  check("roles are explained", (await page.locator(".modal .role-legend").innerText()).includes("Client"));
  await page.keyboard.press("Escape");
  await page.locator(".project-menu select").selectOption("__new");
  await page.fill(".modal input", "Tower A");
  await page.click(".modal button:has-text('Create project')");
  await page.waitForFunction(() => document.querySelector(".project-menu select option:checked")?.textContent === "Tower A", null, { timeout: 10000 });
  check("new project created and opened", true);
  await page.click(".project-menu button");
  await page.locator(".modal select[aria-label='User to add']").selectOption({ label: "Bob Client (bob@example.com) · Client" });
  await page.click(".modal button:has-text('Add member')");
  await settle(page);
  check("admin adds the client to the project; members show their role", /Bob Client[\s\S]*Client/.test(await page.locator(".modal .grid-table").innerText()));
  await page.keyboard.press("Escape");

  // ---- Issue from a selection, with viewpoint + snapshot -----------------------------------------------
  await openModel(page, fixture("extra/box.ifc"));
  await openModel(page, fixture("ifc/Building-Architecture-ifc4.ifc"));
  for (let i = 0; i < 60; i++) { const c = page.locator('.tree button.caret[aria-label="Expand"]'); if (!(await c.count())) break; await c.first().click(); await page.waitForTimeout(40); }
  await page.locator(".tree .row .label", { hasText: "house right front" }).click();
  await page.waitForSelector(".props", { timeout: 10000 });
  await settle(page, 2000);
  await page.click("button:has-text('Section')");
  await page.locator("input[type=range]").fill("0.6");
  await settle(page, 800);
  const camAtIssue = await camera(page);
  const issueBcfExpected = await page.evaluate(() => {
    const c = window.__bimControls.camera;
    const base = window.__bim.fragments.core.baseCoordinates;
    return { pos: c.position.toArray(), base };
  });
  await page.click(".toolbar button:has-text('+ Issue')");
  await page.fill(".modal input >> nth=0", "Render crack on front wall");
  await page.fill(".modal textarea", "Visible from the street");
  await page.locator(".modal label:has-text('Priority') select").selectOption("high");
  await page.locator(".modal label:has-text('Assignee') select").selectOption({ label: "Ada Admin" });
  await page.click(".modal button:has-text('Create issue')");
  await page.waitForSelector(".issue-detail", { timeout: 20000 });
  check("issue created and opened in the Issues tab", (await page.locator(".issue-detail input.issue-title").inputValue()) === "Render crack on front wall");
  check("issue has a snapshot", (await page.locator(".issue-snapshot").count()) === 1);
  await page.waitForFunction(() => { const img = document.querySelector(".issue-snapshot"); return img && img.complete && img.naturalWidth > 100; }, null, { timeout: 10000 });
  check("snapshot image loads", true);
  check("selected element attached", (await page.locator(".issue-detail .row .label").allInnerTexts()).some((t) => t.includes("house right front")));

  // Move away, then restore.
  await page.click("button.active:has-text('Section')");
  await page.evaluate(async () => { await window.__bimControls.setLookAt(50, 40, 60, 0, 0, 0, false); });
  await page.click("text=Clear selection");
  await settle(page);
  await page.click(".issue-detail button:has-text('Show in model')");
  await settle(page, 2500);
  const camRestored = await camera(page);
  check("Show in model restores the camera", dist(camRestored.pos, camAtIssue.pos) < 0.01, `(Δ ${dist(camRestored.pos, camAtIssue.pos).toFixed(4)} m)`);
  check("Show in model restores the section", (await page.locator("button.active", { hasText: "Section" }).count()) === 1 && (await page.locator("input[type=range]").inputValue()) === "0.6");
  check("Show in model selects the element", (await page.locator(".props").innerText()).includes("house right front"));
  check("element's issues are listed under Properties", (await page.locator(".notes .issue-card").allInnerTexts()).some((t) => t.includes("Render crack")));

  // Comment + status.
  await page.fill(".issue-detail textarea[aria-label=Comment]", "Scaffolding booked for Monday");
  await page.click(".issue-detail button:has-text('Comment')");
  await page.waitForSelector(".issue-detail .comment", { timeout: 10000 });
  check("comment added with author", (await page.locator(".issue-detail .comment").innerText()).includes("Ada Admin"));
  await page.locator(".issue-detail label:has-text('Status') select").selectOption("in_progress");
  await settle(page);
  await page.click(".issue-detail button:has-text('All issues')");
  await settle(page);
  const card = await page.locator(".issue-card").first().innerText();
  check("issue list shows status, priority, assignee, comments", card.includes("In progress") && card.includes("High") && card.includes("Ada Admin") && card.includes("💬 1"), card.replace(/\s+/g, " "));

  // ---- BCF export: structure and IFC coordinates ----------------------------------------------------------
  const projectId = await page.evaluate(() => document.querySelector(".project-menu select").value);
  const exportHref = await page.locator("a:has-text('Export BCF')").getAttribute("href");
  check("BCF export link targets the current project", exportHref.includes(`/projects/${projectId}/bcf`), exportHref);
  const zipBytes = await page.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), exportHref);
  fs.writeFileSync(output("export.bcfzip"), Buffer.from(zipBytes));
  const files = unzipSync(new Uint8Array(zipBytes));
  const topicDir = Object.keys(files).find((f) => f.endsWith("/markup.bcf")).split("/")[0];
  const markup = strFromU8(files[`${topicDir}/markup.bcf`]);
  const vp = strFromU8(files[`${topicDir}/viewpoint.bcfv`]);
  check("BCF zip has version, markup, viewpoint and snapshot", !!files["bcf.version"] && !!files[`${topicDir}/snapshot.png`] && markup.includes("TopicStatus=\"In Progress\"") && markup.includes("<Priority>High</Priority>"));
  check("BCF selection lists the element GUID", vp.includes('IfcGuid="1AQAupaRP1txwK1AGiN61V"'));
  const num = (tag) => { const m = vp.match(new RegExp(`<${tag}><X>([^<]+)</X><Y>([^<]+)</Y><Z>([^<]+)</Z></${tag}>`)); return m ? m.slice(1).map(Number) : null; };
  const vpPos = num("CameraViewPoint");
  // Expected: viewer (x, y, z) + base offset (Y-up) → IFC (x, -z, y).
  const [bx, by, bz] = issueBcfExpected.base ?? [0, 0, 0];
  const w = [issueBcfExpected.pos[0] + bx, issueBcfExpected.pos[1] + by, issueBcfExpected.pos[2] + bz];
  const expectedIfc = [w[0], -w[2], w[1]];
  check("BCF camera is in IFC coordinates (Z up)", vpPos && dist(vpPos, expectedIfc) < 1e-3, JSON.stringify({ vpPos, expectedIfc }));
  check("BCF has the section as a clipping plane", vp.includes("<ClippingPlane>"));

  // ---- BCF import into another project; camera restored from BCF alone -----------------------------------
  await page.locator(".project-menu select").selectOption("__new");
  await page.fill(".modal input", "Import target");
  await page.click(".modal button:has-text('Create project')");
  await page.waitForFunction(() => document.querySelector(".project-menu select option:checked")?.textContent === "Import target", null, { timeout: 10000 });
  await settle(page);
  check("switching project closes the models", (await page.locator(".tree-model").count()) === 0);
  await openModel(page, fixture("extra/box.ifc"));
  await openModel(page, fixture("ifc/Building-Architecture-ifc4.ifc"));
  await tab(page, "Issues");
  await page.setInputFiles(".library input[type=file][accept*=bcf]", output("export.bcfzip"));
  await page.waitForSelector(".toast", { timeout: 10000 });
  check("BCF import reports 1 new issue", (await page.locator(".toast").innerText()).includes("1 new"));
  await page.locator(".toast button").click();
  await page.locator(".library select[aria-label='Status filter']").selectOption("");
  await page.waitForSelector(".issue-card", { timeout: 10000 });
  await page.locator(".issue-card").first().click();
  await page.waitForSelector(".issue-detail", { timeout: 10000 });
  const imported = await page.locator(".issue-detail").innerText();
  check("imported issue keeps title, comment and snapshot", (await page.locator(".issue-detail input.issue-title").inputValue()) === "Render crack on front wall" && imported.includes("Scaffolding booked") && (await page.locator(".issue-snapshot").count()) === 1);
  await page.evaluate(async () => { await window.__bimControls.setLookAt(50, 40, 60, 0, 0, 0, false); });
  await page.click(".issue-detail button:has-text('Show in model')");
  await settle(page, 2500);
  const camFromBcf = await camera(page);
  check("camera restored from the BCF viewpoint alone", dist(camFromBcf.pos, camAtIssue.pos) < 0.01, `(Δ ${dist(camFromBcf.pos, camAtIssue.pos).toFixed(4)} m)`);
  const dirA = [camAtIssue.target[0] - camAtIssue.pos[0], camAtIssue.target[1] - camAtIssue.pos[1], camAtIssue.target[2] - camAtIssue.pos[2]];
  const dirB = [camFromBcf.target[0] - camFromBcf.pos[0], camFromBcf.target[1] - camFromBcf.pos[1], camFromBcf.target[2] - camFromBcf.pos[2]];
  const cos = (dirA[0] * dirB[0] + dirA[1] * dirB[1] + dirA[2] * dirB[2]) / (Math.hypot(...dirA) * Math.hypot(...dirB));
  check("…looking in the same direction", cos > 0.9999, `(cos ${cos.toFixed(6)})`);
  check("…with the section re-created from the BCF clipping plane", (await page.locator("button.active", { hasText: "Section" }).count()) === 1 && Math.abs(Number(await page.locator("input[type=range]").inputValue()) - 0.6) < 0.01);
  check("…and the element selected via its GUID", (await page.locator(".props").innerText()).includes("house right front"));
  await page.screenshot({ path: output("issues-restored.png") });

  // ---- Clash → issue ---------------------------------------------------------------------------------
  await tab(page, "Tree");
  // Remove the first remaining model until none are left (index-based handles go stale after a removal).
  for (let n = await page.locator(".tree-model").count(); n > 0; n--) {
    await page.locator(".model-row button[title='Remove model']").first().click();
    await page.waitForFunction((k) => document.querySelectorAll(".tree-model").length < k, n, { timeout: 10000 });
  }
  await openModel(page, fixture("extra/box.ifc"));
  await openModel(page, fixture("extra/mep-pipes.ifc"));
  await tab(page, "Clash");
  await page.click(".library button:has-text('Run')");
  await page.waitForSelector(".clash-row", { timeout: 60000 });
  await settle(page, 500);
  await page.locator(".clash-row button[title='Create an issue for this clash']").first().click();
  await page.waitForSelector(".clash-row button.link", { timeout: 30000 });
  const clashIssueNumber = (await page.locator(".clash-row button.link").first().innerText()).replace("#", "");
  const clashIssue = await page.evaluate(async (n) => {
    const projectId = document.querySelector(".project-menu select").value;
    const list = await (await fetch(`/api/issues?projectId=${projectId}`)).json();
    return list.find((i) => String(i.number) === n);
  }, clashIssueNumber);
  check("clash creates an issue with both elements, type clash and a snapshot", clashIssue?.type === "clash" && clashIssue.components.length === 2 && clashIssue.hasSnapshot && /Test box × Pipe through box/.test(clashIssue.title), JSON.stringify(clashIssue && { t: clashIssue.title, c: clashIssue.components.length }));

  // ---- Viewer role -----------------------------------------------------------------------------------------
  await page.click(".project-menu button");
  await page.locator(".modal .tabs button", { hasText: "Account" }).click();
  await page.click(".modal button:has-text('Sign out')");
  await page.waitForSelector(".auth-card", { timeout: 10000 });
  check("sign out returns to the sign-in screen", (await page.locator(".auth-card h1").innerText()) === "Sign in");
  await page.fill("input[type=email]", "bob@example.com");
  await page.fill("input[type=password]", "wrong-password");
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector(".form-error", { timeout: 10000 });
  check("wrong password is rejected", (await page.locator(".form-error").innerText()).includes("Wrong e-mail or password"));
  await page.fill("input[type=password]", "password123");
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector(".toolbar", { timeout: 10000 });
  const opened = await page.waitForFunction(() => !!document.querySelector(".project-menu select")?.value, null, { timeout: 5000 }).then(() => true, () => false);
  const bobProjects = await page.locator(".project-menu select option").allInnerTexts();
  check("viewer sees Tower A (and the default project), not other projects", bobProjects.includes("Tower A") && !bobProjects.includes("Import target"), JSON.stringify(bobProjects));
  check("a project is opened right after sign-in", opened && !bobProjects.includes("No project"), JSON.stringify(bobProjects));
  check("previous user's section state doesn't leak", (await page.locator("button.active", { hasText: "Section" }).count()) === 0);
  check("clients can't create projects", !(await page.locator(".project-menu select option").allInnerTexts()).some((o) => o.includes("New project")));
  await page.locator(".project-menu select").selectOption({ label: "Tower A" });
  await settle(page);
  await tab(page, "Library");
  await page.waitForSelector(".library h3:has-text('Saved views')", { timeout: 10000 });
  check("clients can't delete library models or save views",
    (await page.locator(".library .card button:has-text('Delete')").count()) === 0 &&
    (await page.locator(".library input[aria-label='View name']").count()) === 0);
  await tab(page, "Issues");
  await page.locator(".library select[aria-label='Status filter']").selectOption("");
  await page.waitForSelector(".issue-card", { timeout: 10000 });
  check("clients can't import BCF", (await page.locator("button:has-text('Import BCF')").count()) === 0);

  // Clients raise issues, without triage fields.
  await page.click("button:has-text('+ New issue')");
  await page.waitForSelector(".modal", { timeout: 5000 });
  check("the client's new-issue form has no priority, assignee or due date",
    (await page.locator(".modal label:has-text('Priority')").count()) === 0 &&
    (await page.locator(".modal label:has-text('Assignee')").count()) === 0 &&
    (await page.locator(".modal label:has-text('Due')").count()) === 0);
  await page.fill(".modal input[required]", "Client: door swings the wrong way");
  await page.click(".modal button:has-text('Create issue')");
  await page.waitForSelector(".issue-detail", { timeout: 10000 });
  check("clients raise issues", (await page.locator(".issue-detail .issue-title").inputValue()) === "Client: door swings the wrong way");
  check("…can edit their own issue's title but not triage it or delete it",
    !(await page.locator(".issue-detail .issue-title").isDisabled()) &&
    (await page.locator(".issue-detail label:has-text('Status') select").isDisabled()) &&
    (await page.locator(".issue-detail label:has-text('Assignee') select").isDisabled()) &&
    (await page.locator(".issue-detail button:has-text('Delete issue')").count()) === 0);
  await page.click(".issue-detail button:has-text('All issues')");
  await page.waitForSelector(".issue-card", { timeout: 10000 });
  await page.locator(".issue-card", { hasText: "Render crack on front wall" }).first().click();
  await page.waitForSelector(".issue-detail", { timeout: 10000 });
  check("clients can't edit other people's issues", (await page.locator(".issue-detail .issue-title").isDisabled()) && (await page.locator(".issue-detail label:has-text('Status') select").isDisabled()));
  const commentsBefore = await page.locator(".issue-detail .comment").count();
  await page.fill(".issue-detail textarea[aria-label=Comment]", "Seen it, thanks");
  await page.click(".issue-detail button:has-text('Comment')");
  await page.waitForFunction((n) => document.querySelectorAll(".issue-detail .comment").length === n + 1, commentsBefore, { timeout: 10000 });
  check("clients comment", true);

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  // ---- Server down: viewer still usable ---------------------------------------------------------------------
  await api.stop();
  const page2 = await ctx.newPage();
  await page2.goto(APP_URL);
  await page2.waitForSelector(".auth-card button:has-text('without the server')", { timeout: 20000 });
  await page2.click("button:has-text('without the server')");
  await page2.setInputFiles(".toolbar input[type=file]", fixture("extra/box.ifc"));
  await page2.waitForSelector(".tree-model", { timeout: 60000 });
  check("without the server, the viewer still opens models", true);
} catch (e) {
  console.log("ERROR", e.message.split("\n")[0]);
  await page.screenshot({ path: output("issues-error.png") });
  results.push(false);
} finally {
  finish();
  await browser.close();
  await api.stop();
}
