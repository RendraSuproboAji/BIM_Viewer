import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { ElementRecord, ModelRecord, NoteRecord, ViewRecord, ViewState } from "../../shared/api.ts";
import { buildApp, toCsv } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

let app: FastifyInstance;
let dir: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "bim-api-"));
  app = await buildApp({ dbFile: join(dir, "test.sqlite"), dataDir: dir });
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function uploadModel(name = "house.ifc", bytes = Buffer.from([1, 2, 3, 4])) {
  const res = await app.inject({
    method: "POST",
    url: `/api/models?name=${encodeURIComponent(name)}`,
    headers: { "content-type": "application/octet-stream" },
    payload: bytes,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as ModelRecord;
}

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

describe("models", () => {
  test("upload, list, download and delete", async () => {
    const bytes = Buffer.from("fragments-bytes");
    const model = await uploadModel("school.ifc", bytes);
    assert.equal(model.size, bytes.length);
    assert.equal(model.elementCount, 0);

    const list = (await app.inject("/api/models")).json() as ModelRecord[];
    assert.ok(list.some((m) => m.id === model.id));

    const file = await app.inject(`/api/models/${model.id}/file`);
    assert.equal(file.statusCode, 200);
    assert.deepEqual(file.rawPayload, bytes);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/models/${model.id}` })).statusCode, 204);
    assert.equal((await app.inject(`/api/models/${model.id}/file`)).statusCode, 404);
  });

  test("rejects empty uploads and malformed ids", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/models?name=x",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.alloc(0),
    });
    assert.equal(empty.statusCode, 400);
    assert.equal((await app.inject("/api/models/../../etc/passwd/file")).statusCode, 404);
    assert.equal((await app.inject("/api/models/not-a-uuid/file")).statusCode, 400);
  });
});

describe("elements", () => {
  test("replace, search, categories and CSV export", async () => {
    const model = await uploadModel();
    const put = await app.inject({ method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [wall, pipe] } });
    assert.equal(put.statusCode, 200, put.body);
    assert.equal(((await app.inject(`/api/models/${model.id}`)).json() as ModelRecord).elementCount, 2);

    // Re-saving replaces rather than duplicates.
    await app.inject({ method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [wall, pipe] } });

    const byProperty = (await app.inject(`/api/elements?q=EI60&modelId=${model.id}`)).json();
    assert.equal(byProperty.total, 1);
    assert.equal(byProperty.items[0].guid, wall.guid);
    assert.equal(byProperty.items[0].modelName, "house.ifc");
    assert.deepEqual(byProperty.items[0].properties, wall.properties);

    const byCategory = (await app.inject(`/api/elements?category=ifcpipesegment&modelId=${model.id}`)).json();
    assert.deepEqual(byCategory.items.map((e: ElementRecord) => e.name), ["sewer pipe"]);

    // LIKE wildcards in the query are matched literally.
    assert.equal((await app.inject(`/api/elements?q=%25&modelId=${model.id}`)).json().total, 0);

    const categories = (await app.inject(`/api/elements/categories?modelId=${model.id}`)).json() as { category: string; count: number }[];
    assert.deepEqual(
      categories.sort((a, b) => a.category.localeCompare(b.category)),
      [
        { category: "IFCPIPESEGMENT", count: 1 },
        { category: "IFCWALL", count: 1 },
      ],
    );

    const csv = await app.inject(`/api/models/${model.id}/elements.csv`);
    assert.equal(csv.statusCode, 200);
    assert.match(csv.headers["content-type"] as string, /text\/csv/);
    const lines = csv.body.replace(/^﻿/, "").trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes("Pset_WallCommon.FireRating"));
    assert.ok(lines[0].includes("Qto.Base.Width"));
    assert.ok(lines.some((l) => l.includes('"Outer wall, front"') && l.includes("EI60")));
  });

  test("deleting a model removes its elements", async () => {
    const model = await uploadModel();
    await app.inject({ method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [wall] } });
    await app.inject({ method: "DELETE", url: `/api/models/${model.id}` });
    assert.equal((await app.inject(`/api/elements?modelId=${model.id}`)).json().total, 0);
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
    const created = (await app.inject({ method: "POST", url: "/api/views", payload: { name: "Ground floor", state } })).json() as ViewRecord;
    assert.deepEqual(created.state, state);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/views/${created.id}`,
      payload: { name: "Ground floor (cut)", state: { ...state, ghost: true } },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.json() as ViewRecord).state.ghost, true);

    const list = (await app.inject("/api/views")).json() as ViewRecord[];
    assert.equal(list.find((v) => v.id === created.id)?.name, "Ground floor (cut)");

    assert.equal((await app.inject({ method: "DELETE", url: `/api/views/${created.id}` })).statusCode, 204);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/views/${created.id}` })).statusCode, 404);
  });

  test("validates the body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/views", payload: { name: "" } });
    assert.equal(res.statusCode, 400);
  });
});

describe("notes", () => {
  test("create, filter, update status and cascade on model delete", async () => {
    const model = await uploadModel();
    const create = await app.inject({
      method: "POST",
      url: "/api/notes",
      payload: { modelId: model.id, elementGuid: wall.guid, elementName: wall.name, category: wall.category, title: "Crack in render", body: "North side" },
    });
    assert.equal(create.statusCode, 201, create.body);
    const note = create.json() as NoteRecord;
    assert.equal(note.status, "open");

    const forElement = (await app.inject(`/api/notes?modelId=${model.id}&guid=${wall.guid}`)).json() as NoteRecord[];
    assert.deepEqual(forElement.map((n) => n.id), [note.id]);

    const patched = await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { status: "resolved" } });
    assert.equal((patched.json() as NoteRecord).status, "resolved");
    assert.equal((patched.json() as NoteRecord).title, "Crack in render");
    assert.equal((await app.inject(`/api/notes?status=open&modelId=${model.id}`)).json().length, 0);

    const bad = await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { status: "done" } });
    assert.equal(bad.statusCode, 400);

    await app.inject({ method: "DELETE", url: `/api/models/${model.id}` });
    assert.equal((await app.inject(`/api/notes?modelId=${model.id}`)).json().length, 0);
  });

  test("needs an existing model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notes",
      payload: { modelId: "00000000-0000-0000-0000-000000000000", elementGuid: "x", title: "t" },
    });
    assert.equal(res.statusCode, 404);
  });
});

describe("database", () => {
  test("migrations are idempotent across restarts", () => {
    const file = join(dir, "reopen.sqlite");
    openDatabase(file).close();
    const db = openDatabase(file);
    assert.equal(db.pragma("user_version", { simple: true }), 1);
    db.close();
  });

  test("csv neutralises formulas but keeps negative numbers", () => {
    const csv = toCsv([{ ...wall, name: "=HYPERLINK(\"x\")", properties: { P: { Offset: "-5" } } }]);
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv.includes(",-5"));
  });
});
