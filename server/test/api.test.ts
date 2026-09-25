import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import type { ElementRecord, IssueDetail, Issue, ModelRecord, User, ViewRecord, ViewState } from "../../shared/api.ts";
import { toCsv } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { PNG_1PX, testServer } from "./helpers.ts";

const wall: ElementRecord = {
  localId: 158,
  guid: "1AQAupaRP1txwK1AGiN61V",
  category: "IFCWALL",
  name: "Outer wall, front",
  storey: "00 groundfloor",
  properties: { Pset_WallCommon: { FireRating: "EI60", IsExternal: "Yes" }, "Qto.Base": { Width: "200" } },
};
const pipe: ElementRecord = {
  localId: 20,
  guid: "0dEBwmfnvBq9OyNfYNowGR",
  category: "IFCPIPESEGMENT",
  name: "sewer pipe",
  storey: null,
  properties: { Pset_PipeSegmentTypeCommon: { NominalDiameter: "300" } },
};

let t: Awaited<ReturnType<typeof testServer>>;
let admin: { cookie: string; user: User };
let projectId: string;
before(async () => {
  t = await testServer();
  admin = await t.setupAdmin();
  projectId = (await t.createProject(admin.cookie)).id;
});
after(async () => t.close());

const upload = async (name = "house.ifc", bytes = Buffer.from([1, 2, 3, 4])) => {
  const res = await t.uploadModel(admin.cookie, projectId, name, bytes);
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as ModelRecord;
};
const as = (opts: Parameters<typeof t.as>[1]) => t.as(admin.cookie, opts);

describe("models", () => {
  test("upload, list, download and delete", async () => {
    const bytes = Buffer.from("fragments-bytes");
    const model = await upload("school.ifc", bytes);
    assert.equal(model.size, bytes.length);
    assert.equal(model.projectId, projectId);
    assert.ok(((await as(`/api/models?projectId=${projectId}`)).json() as ModelRecord[]).some((m) => m.id === model.id));
    const file = await as(`/api/models/${model.id}/file`);
    assert.equal(file.statusCode, 200);
    assert.deepEqual(file.rawPayload, bytes);
    assert.equal((await as({ method: "DELETE", url: `/api/models/${model.id}` })).statusCode, 204);
    assert.equal((await as(`/api/models/${model.id}/file`)).statusCode, 404);
  });

  test("rejects empty uploads, malformed ids and missing project", async () => {
    const empty = await as({ method: "POST", url: `/api/models?projectId=${projectId}&name=x`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(0) });
    assert.equal(empty.statusCode, 400);
    assert.equal((await as("/api/models/not-a-uuid/file")).statusCode, 400);
    assert.equal((await as("/api/models")).statusCode, 400);
  });

  test("returns 404 when the .frag was removed from disk", async () => {
    const model = await upload();
    rmSync(join(t.dir, "models", `${model.id}.frag`));
    assert.equal((await as(`/api/models/${model.id}/file`)).statusCode, 404);
  });

  test("models of other projects are invisible", async () => {
    const model = await upload();
    const eve = await t.createMember(admin.cookie, "eve@example.com");
    assert.equal((await t.as(eve.cookie, `/api/models/${model.id}`)).statusCode, 404);
    assert.equal((await t.as(eve.cookie, `/api/models/${model.id}/file`)).statusCode, 404);
    assert.equal((await t.as(eve.cookie, { method: "DELETE", url: `/api/models/${model.id}` })).statusCode, 404);
  });
});

describe("elements", () => {
  test("replace, search, categories and CSV export", async () => {
    const model = await upload();
    const put = await as({ method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [wall, pipe] } });
    assert.equal(put.statusCode, 200, put.body);
    assert.equal(((await as(`/api/models/${model.id}`)).json() as ModelRecord).elementCount, 2);
    // Re-saving replaces rather than duplicates.
    await as({ method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [wall, pipe] } });

    const byProperty = (await as(`/api/elements?projectId=${projectId}&q=EI60&modelId=${model.id}`)).json();
    assert.equal(byProperty.total, 1);
    assert.equal(byProperty.items[0].guid, wall.guid);
    assert.deepEqual(byProperty.items[0].properties, wall.properties);
    const byCategory = (await as(`/api/elements?projectId=${projectId}&category=ifcpipesegment&modelId=${model.id}`)).json();
    assert.deepEqual(byCategory.items.map((e: ElementRecord) => e.name), ["sewer pipe"]);
    // LIKE wildcards in the query are matched literally.
    assert.equal((await as(`/api/elements?projectId=${projectId}&q=%25&modelId=${model.id}`)).json().total, 0);
    const categories = (await as(`/api/elements/categories?projectId=${projectId}&modelId=${model.id}`)).json() as { category: string }[];
    assert.deepEqual(categories.map((c) => c.category).sort(), ["IFCPIPESEGMENT", "IFCWALL"]);

    const csv = await as(`/api/models/${model.id}/elements.csv`);
    assert.match(csv.headers["content-type"] as string, /text\/csv/);
    const lines = csv.body.replace(/^﻿/, "").trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes("Pset_WallCommon.FireRating") && lines[0].includes("Qto.Base.Width"));
    assert.ok(lines.some((l) => l.includes('"Outer wall, front"') && l.includes("EI60")));
  });

  test("search is limited to the project", async () => {
    const other = await t.createProject(admin.cookie, "Other");
    assert.equal((await as(`/api/elements?projectId=${other.id}&q=EI60`)).json().total, 0);
  });
});

describe("views", () => {
  const state: ViewState = {
    camera: { position: [10, 20, 30], target: [0, 0, 0] },
    section: { enabled: true, axis: "y", offset: 0.4, flipped: false },
    hiddenClasses: ["IFCSPACE"],
    ghost: false,
    models: [],
  };

  test("create, update, list and delete", async () => {
    const created = (await as({ method: "POST", url: "/api/views", payload: { projectId, name: "Ground floor", state } })).json() as ViewRecord;
    assert.deepEqual(created.state, state);
    const updated = await as({ method: "PUT", url: `/api/views/${created.id}`, payload: { name: "Cut", state: { ...state, ghost: true } } });
    assert.equal((updated.json() as ViewRecord).state.ghost, true);
    assert.equal(((await as(`/api/views?projectId=${projectId}`)).json() as ViewRecord[]).find((v) => v.id === created.id)?.name, "Cut");
    assert.equal((await as({ method: "DELETE", url: `/api/views/${created.id}` })).statusCode, 204);
    assert.equal((await as({ method: "DELETE", url: `/api/views/${created.id}` })).statusCode, 404);
  });

  test("validates the state", async () => {
    assert.equal((await as({ method: "POST", url: "/api/views", payload: { projectId, name: "" } })).statusCode, 400);
    const badCamera = await as({ method: "POST", url: "/api/views", payload: { projectId, name: "x", state: { ...state, camera: { position: [1, 2], target: [0, 0, 0] } } } });
    assert.equal(badCamera.statusCode, 400);
    const badAxis = await as({ method: "POST", url: "/api/views", payload: { projectId, name: "x", state: { ...state, section: { ...state.section, axis: "w" } } } });
    assert.equal(badAxis.statusCode, 400);
  });
});

describe("issues", () => {
  test("create with components, viewpoint and snapshot; numbering; comments; filters", async () => {
    const model = await upload();
    const viewpoint = {
      bcf: { camera: { viewPoint: [1, 2, 3], direction: [0, 1, 0], upVector: [0, 0, 1], fieldOfView: 60 }, clippingPlanes: [{ location: [0, 0, 1.5], direction: [0, 0, -1] }] },
    };
    const res = await as({
      method: "POST",
      url: "/api/issues",
      payload: {
        projectId,
        title: "Pipe hits wall",
        description: "Clash at grid B-3",
        type: "clash",
        priority: "high",
        assigneeId: admin.user.id,
        dueDate: "2026-10-01",
        labels: ["MEP", "Level 1"],
        components: [
          { modelId: model.id, guid: wall.guid, name: wall.name, category: wall.category },
          { modelId: model.id, guid: pipe.guid, name: pipe.name, category: pipe.category },
        ],
        viewpoint,
        snapshot: PNG_1PX,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const issue = res.json() as IssueDetail;
    assert.equal(issue.status, "open");
    assert.equal(issue.authorName, "Admin");
    assert.equal(issue.assigneeName, "Admin");
    assert.equal(issue.components.length, 2);
    assert.deepEqual(issue.viewpoint, viewpoint);
    assert.equal(issue.hasSnapshot, true);
    const second = (await as({ method: "POST", url: "/api/issues", payload: { projectId, title: "Second" } })).json() as Issue;
    assert.equal(second.number, issue.number + 1);

    const png = await as(`/api/issues/${issue.id}/snapshot.png`);
    assert.equal(png.headers["content-type"], "image/png");
    assert.deepEqual(png.rawPayload, Buffer.from(PNG_1PX, "base64"));
    const notPng = await as({ method: "POST", url: "/api/issues", payload: { projectId, title: "x", snapshot: Buffer.from("hello").toString("base64") } });
    assert.equal(notPng.statusCode, 400);

    const byGuid = (await as(`/api/issues?projectId=${projectId}&guid=${pipe.guid}`)).json() as Issue[];
    assert.deepEqual(byGuid.map((i) => i.id), [issue.id]);

    const withComment = (await as({ method: "POST", url: `/api/issues/${issue.id}/comments`, payload: { body: "Rerouting the pipe" } })).json() as IssueDetail;
    assert.equal(withComment.comments[0].body, "Rerouting the pipe");
    assert.equal(withComment.comments[0].authorName, "Admin");

    const patched = (await as({ method: "PATCH", url: `/api/issues/${issue.id}`, payload: { status: "resolved", components: [{ modelId: model.id, guid: pipe.guid }] } })).json() as IssueDetail;
    assert.equal(patched.status, "resolved");
    assert.equal(patched.components.length, 1);
    assert.equal((await as(`/api/issues?projectId=${projectId}&status=resolved`)).json().length, 1);

    // Deleting the model keeps the issue but unlinks its components.
    await as({ method: "DELETE", url: `/api/models/${model.id}` });
    assert.equal(((await as(`/api/issues/${issue.id}`)).json() as IssueDetail).components[0].modelId, null);
  });

  test("validates references and permissions", async () => {
    const outsider = await t.createMember(admin.cookie, "mallory@example.com");
    const notMember = await as({ method: "POST", url: "/api/issues", payload: { projectId, title: "x", assigneeId: outsider.user.id } });
    assert.equal(notMember.statusCode, 400);
    const otherProject = await t.createProject(admin.cookie, "Elsewhere");
    const foreignModel = (await t.uploadModel(admin.cookie, otherProject.id)).json() as ModelRecord;
    const foreign = await as({ method: "POST", url: "/api/issues", payload: { projectId, title: "x", components: [{ modelId: foreignModel.id, guid: "g" }] } });
    assert.equal(foreign.statusCode, 400);
    const issue = (await as({ method: "POST", url: "/api/issues", payload: { projectId, title: "Private" } })).json() as Issue;
    assert.equal((await t.as(outsider.cookie, `/api/issues/${issue.id}`)).statusCode, 404);
    assert.equal((await as({ method: "PATCH", url: `/api/issues/${issue.id}`, payload: { status: "done" } })).statusCode, 400);
  });

  test("BCF export then import round-trips topics, comments, viewpoints and snapshots", async () => {
    const project = await t.createProject(admin.cookie, "BCF test");
    const model = (await t.uploadModel(admin.cookie, project.id)).json() as ModelRecord;
    await as({ method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [wall, pipe] } });
    const viewpoint = { bcf: { camera: { viewPoint: [10.5, -4, 3.25], direction: [-0.6, 0.8, 0], upVector: [0, 0, 1], fieldOfView: 45 }, clippingPlanes: [{ location: [0, 0, 2], direction: [0, 0, -1] }] } };
    const issue = (await as({
      method: "POST",
      url: "/api/issues",
      payload: {
        projectId: project.id,
        title: "Duct <blocks> door & window",
        description: "Line 1\nLine 2 \"quoted\"",
        type: "clash",
        priority: "critical",
        assigneeId: admin.user.id,
        dueDate: "2026-12-24",
        labels: ["HVAC"],
        components: [{ modelId: model.id, guid: wall.guid }, { modelId: model.id, guid: pipe.guid }],
        viewpoint,
        snapshot: PNG_1PX,
      },
    })).json() as Issue;
    await as({ method: "POST", url: `/api/issues/${issue.id}/comments`, payload: { body: "Checked on site" } });

    const exported = await as(`/api/projects/${project.id}/bcf`);
    assert.equal(exported.statusCode, 200);
    const files = unzipSync(new Uint8Array(exported.rawPayload));
    assert.ok(files["bcf.version"]);
    const markup = strFromU8(files[`${issue.bcfGuid}/markup.bcf`]);
    assert.match(markup, /TopicStatus="Open"/);
    assert.match(markup, /<Title>Duct &lt;blocks&gt; door &amp; window<\/Title>/);
    assert.match(markup, /<AssignedTo>admin@example.com<\/AssignedTo>/);
    assert.ok(strFromU8(files[`${issue.bcfGuid}/viewpoint.bcfv`]).includes(`IfcGuid="${pipe.guid}"`));
    assert.ok(files[`${issue.bcfGuid}/snapshot.png`]);

    // Import into a fresh project: everything comes back, and components link to its library model by GUID.
    const target = await t.createProject(admin.cookie, "Import target");
    const targetModel = (await t.uploadModel(admin.cookie, target.id)).json() as ModelRecord;
    await as({ method: "PUT", url: `/api/models/${targetModel.id}/elements`, payload: { elements: [wall, pipe] } });
    const importOnce = async () =>
      as({ method: "POST", url: `/api/projects/${target.id}/bcf`, headers: { "content-type": "application/octet-stream" }, payload: exported.rawPayload });
    const first = await importOnce();
    assert.deepEqual(first.json(), { created: 1, updated: 0 });
    const [imported] = (await as(`/api/issues?projectId=${target.id}`)).json() as Issue[];
    const full = (await as(`/api/issues/${imported.id}`)).json() as IssueDetail;
    assert.equal(full.title, "Duct <blocks> door & window");
    assert.equal(full.description, "Line 1\nLine 2 \"quoted\"");
    assert.equal(full.type, "clash");
    assert.equal(full.priority, "critical");
    assert.equal(full.dueDate, "2026-12-24");
    assert.deepEqual(full.labels, ["HVAC"]);
    assert.equal(full.assigneeId, admin.user.id);
    assert.equal(full.hasSnapshot, true);
    assert.deepEqual(full.viewpoint, viewpoint);
    assert.deepEqual(full.components.map((c) => [c.guid, c.modelId, c.name]).sort(), [[pipe.guid, targetModel.id, pipe.name], [wall.guid, targetModel.id, wall.name]].sort());
    assert.deepEqual(full.comments.map((c) => c.body), ["Checked on site"]);

    // Re-importing updates in place (matched by topic GUID) without duplicating comments.
    const second = await importOnce();
    assert.deepEqual(second.json(), { created: 0, updated: 1 });
    assert.equal(((await as(`/api/issues/${imported.id}`)).json() as IssueDetail).comments.length, 1);
  });

  test("imports BCF from other tools (status names, BCF 3 layout) and rejects junk", async () => {
    const markup = `<?xml version="1.0" encoding="UTF-8"?>
<Markup><Topic Guid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" TopicType="Error" TopicStatus="Active">
<Title>From another tool</Title><Priority>Major</Priority><CreationDate>2025-01-02T03:04:05Z</CreationDate><CreationAuthor>someone@else.com</CreationAuthor>
<Labels><Label>Structure</Label></Labels><Comments><Comment Guid="c1"><Date>2025-01-03T00:00:00Z</Date><Author>someone@else.com</Author><Comment>First!</Comment></Comment></Comments>
</Topic></Markup>`;
    const zip = zipSync({ "bcf.version": strToU8("<Version VersionId=\"3.0\"/>"), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/markup.bcf": strToU8(markup) });
    const res = await as({ method: "POST", url: `/api/projects/${projectId}/bcf`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from(zip) });
    assert.deepEqual(res.json(), { created: 1, updated: 0 });
    const issue = ((await as(`/api/issues?projectId=${projectId}`)).json() as Issue[]).find((i) => i.title === "From another tool")!;
    assert.equal(issue.status, "in_progress");
    assert.equal(issue.priority, "high");
    assert.equal(issue.type, "error");
    assert.deepEqual(issue.labels, ["Structure"]);
    assert.equal(issue.authorId, admin.user.id); // unknown author → importing user
    assert.equal(((await as(`/api/issues/${issue.id}`)).json() as IssueDetail).comments[0].body, "First!");

    const junk = await as({ method: "POST", url: `/api/projects/${projectId}/bcf`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("not a zip") });
    assert.equal(junk.statusCode, 400);
  });
});

describe("static web app", () => {
  test("serves index for app routes, 404 for missing files and API routes", async () => {
    const staticDir = mkdtempSync(join(tmpdir(), "bim-static-"));
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>BIM</title>");
    const web = await testServer({ staticDir });
    try {
      assert.equal((await web.app.inject("/")).statusCode, 200);
      const route = await web.app.inject("/projects/42");
      assert.equal(route.statusCode, 200);
      assert.match(route.body, /<title>BIM<\/title>/);
      assert.equal((await web.app.inject("/assets/missing.js")).statusCode, 404);
      assert.equal((await web.app.inject("/api/nope")).statusCode, 401);
    } finally {
      await web.close();
      rmSync(staticDir, { recursive: true, force: true });
    }
  });
});

describe("database", () => {
  test("migrations are idempotent across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "bim-db-"));
    const file = join(dir, "reopen.sqlite");
    openDatabase(file).close();
    const db = openDatabase(file);
    assert.equal(db.pragma("user_version", { simple: true }), 2);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("csv neutralises formulas but keeps negative numbers", () => {
    const csv = toCsv([{ ...wall, name: '=HYPERLINK("x")', properties: { P: { Offset: "-5" } } }]);
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv.includes(",-5"));
  });
});
