import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  NOTE_STATUSES,
  type CategoryCount,
  type ElementRecord,
  type ElementSearchResponse,
  type ModelRecord,
  type NewNote,
  type NotePatch,
  type NoteRecord,
  type ViewRecord,
  type ViewState,
} from "../../shared/api.ts";
import { openDatabase, type Db } from "./db.ts";

export interface AppOptions {
  /** SQLite file path, or ":memory:". */
  dbFile: string;
  /** Directory holding uploaded .frag files. */
  dataDir: string;
  /** Built web app to serve (production). Omit to serve the API only. */
  staticDir?: string;
  maxUploadMb?: number;
  logger?: boolean;
}

const ID = { type: "string", pattern: "^[0-9a-f-]{36}$" } as const;
const idParams = { type: "object", required: ["id"], properties: { id: ID } } as const;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  mkdirSync(join(options.dataDir, "models"), { recursive: true });
  const db = openDatabase(options.dbFile);
  const bodyLimit = (options.maxUploadMb ?? 500) * 1024 * 1024;

  const app = Fastify({ logger: options.logger ?? false });
  app.addHook("onClose", async () => db.close());
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit }, (_req, body, done) =>
    done(null, body),
  );

  const modelFile = (id: string) => join(options.dataDir, "models", `${id}.frag`);
  const q = queries(db);

  app.get("/api/health", async () => ({ ok: true }));

  // ---- Model library -------------------------------------------------------

  app.get("/api/models", async () => q.listModels.all().map(toModel));

  app.post<{ Querystring: { name: string; fileName?: string }; Body: Buffer }>(
    "/api/models",
    {
      bodyLimit,
      schema: {
        querystring: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 255 }, fileName: { type: "string", maxLength: 255 } },
        },
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return reply.code(400).send({ error: "Send the .frag bytes as application/octet-stream" });
      }
      const id = randomUUID();
      await writeFile(modelFile(id), req.body);
      try {
        q.insertModel.run({ id, name: req.query.name, file_name: req.query.fileName ?? `${req.query.name}.frag`, size: req.body.length });
      } catch (e) {
        await rm(modelFile(id), { force: true }); // no orphaned files
        throw e;
      }
      return reply.code(201).send(toModel(q.getModel.get(id)));
    },
  );

  app.get<{ Params: { id: string } }>("/api/models/:id", { schema: { params: idParams } }, async (req, reply) => {
    const row = q.getModel.get(req.params.id);
    return row ? toModel(row) : reply.code(404).send({ error: "Model not found" });
  });

  app.get<{ Params: { id: string } }>("/api/models/:id/file", { schema: { params: idParams } }, async (req, reply) => {
    const row = q.getModel.get(req.params.id);
    const file = modelFile(req.params.id);
    if (!row || !existsSync(file)) return reply.code(404).send({ error: "Model not found" });
    // Streamed, so large models are never held in memory.
    return reply.type("application/octet-stream").header("content-length", (await stat(file)).size).send(createReadStream(file));
  });

  app.delete<{ Params: { id: string } }>("/api/models/:id", { schema: { params: idParams } }, async (req, reply) => {
    // Elements and notes go with it (ON DELETE CASCADE).
    if (q.deleteModel.run(req.params.id).changes === 0) return reply.code(404).send({ error: "Model not found" });
    await rm(modelFile(req.params.id), { force: true });
    return reply.code(204).send();
  });

  // ---- Extracted BIM data --------------------------------------------------

  app.put<{ Params: { id: string }; Body: { elements: ElementRecord[] } }>(
    "/api/models/:id/elements",
    {
      bodyLimit,
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["elements"],
          properties: {
            elements: {
              type: "array",
              items: {
                type: "object",
                required: ["localId", "category"],
                properties: {
                  localId: { type: "integer" },
                  guid: { type: ["string", "null"] },
                  category: { type: "string" },
                  name: { type: ["string", "null"] },
                  storey: { type: ["string", "null"] },
                  properties: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const modelId = req.params.id;
      if (!q.getModel.get(modelId)) return reply.code(404).send({ error: "Model not found" });
      // Replace the whole set atomically so re-saving a model never leaves stale rows.
      db.transaction((elements: ElementRecord[]) => {
        q.deleteElements.run(modelId);
        for (const e of elements) {
          q.insertElement.run({
            model_id: modelId,
            local_id: e.localId,
            guid: e.guid ?? null,
            category: e.category,
            name: e.name ?? null,
            storey: e.storey ?? null,
            properties: JSON.stringify(e.properties ?? {}),
          });
        }
        q.setElementCount.run(elements.length, modelId);
      })(req.body.elements);
      return { count: req.body.elements.length };
    },
  );

  app.get<{ Params: { id: string } }>("/api/models/:id/elements.csv", { schema: { params: idParams } }, async (req, reply) => {
    const model = q.getModel.get(req.params.id);
    if (!model) return reply.code(404).send({ error: "Model not found" });
    const rows = q.modelElements.all(req.params.id).map(toElement);
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${safeFileName(model.name)}-elements.csv"`)
      .send(toCsv(rows));
  });

  app.get<{ Querystring: { q?: string; category?: string; modelId?: string; limit?: number; offset?: number } }>(
    "/api/elements",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string", maxLength: 200 },
            category: { type: "string", maxLength: 100 },
            modelId: ID,
            limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    },
    async (req): Promise<ElementSearchResponse> => {
      const { q: text, category, modelId, limit = 50, offset = 0 } = req.query;
      const where: string[] = [];
      const params: Record<string, unknown> = { limit, offset };
      if (modelId) {
        where.push("e.model_id = @modelId");
        params.modelId = modelId;
      }
      if (category) {
        where.push("e.category = @category");
        params.category = category.toUpperCase();
      }
      if (text) {
        // Matches name, GUID, class, storey and any property name/value.
        where.push(
          "(e.name LIKE @like ESCAPE '\\' OR e.guid LIKE @like ESCAPE '\\' OR e.category LIKE @like ESCAPE '\\' OR e.storey LIKE @like ESCAPE '\\' OR e.properties LIKE @like ESCAPE '\\')",
        );
        params.like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM elements e ${clause}`).get(params) as { n: number }).n;
      const rows = db
        .prepare(
          `SELECT e.*, m.name AS model_name FROM elements e JOIN models m ON m.id = e.model_id ${clause}
           ORDER BY m.name, e.category, e.name, e.local_id LIMIT @limit OFFSET @offset`,
        )
        .all(params) as (ElementRow & { model_name: string })[];
      return { total, items: rows.map((r) => ({ ...toElement(r), modelId: r.model_id, modelName: r.model_name })) };
    },
  );

  app.get<{ Querystring: { modelId?: string } }>(
    "/api/elements/categories",
    { schema: { querystring: { type: "object", properties: { modelId: ID } } } },
    async (req): Promise<CategoryCount[]> =>
      (req.query.modelId ? q.categoriesOfModel.all(req.query.modelId) : q.categories.all()) as CategoryCount[],
  );

  // ---- Saved views ---------------------------------------------------------

  const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } as const;
  const viewBody = {
    type: "object",
    required: ["name", "state"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 255 },
      // Validated fully: a malformed view would break the client when restored.
      state: {
        type: "object",
        required: ["camera", "section", "hiddenClasses", "ghost", "models"],
        properties: {
          camera: { type: "object", required: ["position", "target"], properties: { position: vec3, target: vec3 } },
          section: {
            type: "object",
            required: ["enabled", "axis", "offset", "flipped"],
            properties: {
              enabled: { type: "boolean" },
              axis: { type: "string", enum: ["x", "y", "z"] },
              offset: { type: "number", minimum: 0, maximum: 1 },
              flipped: { type: "boolean" },
            },
          },
          hiddenClasses: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 1000 },
          ghost: { type: "boolean" },
          models: { type: "array", items: ID, maxItems: 100 },
        },
      },
    },
  } as const;

  app.get("/api/views", async () => q.listViews.all().map(toView));

  app.post<{ Body: { name: string; state: ViewState } }>("/api/views", { schema: { body: viewBody } }, async (req, reply) => {
    const id = randomUUID();
    q.insertView.run({ id, name: req.body.name, state: JSON.stringify(req.body.state) });
    return reply.code(201).send(toView(q.getView.get(id)));
  });

  app.put<{ Params: { id: string }; Body: { name: string; state: ViewState } }>(
    "/api/views/:id",
    { schema: { params: idParams, body: viewBody } },
    async (req, reply) => {
      const changes = q.updateView.run({ id: req.params.id, name: req.body.name, state: JSON.stringify(req.body.state) }).changes;
      return changes ? toView(q.getView.get(req.params.id)) : reply.code(404).send({ error: "View not found" });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/views/:id", { schema: { params: idParams } }, async (req, reply) => {
    if (q.deleteView.run(req.params.id).changes === 0) return reply.code(404).send({ error: "View not found" });
    return reply.code(204).send();
  });

  // ---- Element notes / issues ----------------------------------------------

  const status = { type: "string", enum: [...NOTE_STATUSES] } as const;

  app.get<{ Querystring: { modelId?: string; guid?: string; status?: string } }>(
    "/api/notes",
    { schema: { querystring: { type: "object", properties: { modelId: ID, guid: { type: "string", maxLength: 64 }, status } } } },
    async (req) => {
      const where: string[] = [];
      const params: Record<string, string> = {};
      for (const [key, column] of [
        ["modelId", "model_id"],
        ["guid", "element_guid"],
        ["status", "status"],
      ] as const) {
        const value = req.query[key];
        if (value) {
          where.push(`${column} = @${key}`);
          params[key] = value;
        }
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      return (db.prepare(`SELECT * FROM notes ${clause} ORDER BY updated_at DESC`).all(params) as NoteRow[]).map(toNote);
    },
  );

  app.post<{ Body: NewNote }>(
    "/api/notes",
    {
      schema: {
        body: {
          type: "object",
          required: ["modelId", "elementGuid", "title"],
          properties: {
            modelId: ID,
            elementGuid: { type: "string", minLength: 1, maxLength: 64 },
            elementName: { type: ["string", "null"], maxLength: 500 },
            category: { type: ["string", "null"], maxLength: 100 },
            title: { type: "string", minLength: 1, maxLength: 255 },
            body: { type: "string", maxLength: 20000 },
            status,
          },
        },
      },
    },
    async (req, reply) => {
      if (!q.getModel.get(req.body.modelId)) return reply.code(404).send({ error: "Model not found" });
      const id = randomUUID();
      const b = req.body;
      q.insertNote.run({
        id,
        model_id: b.modelId,
        element_guid: b.elementGuid,
        element_name: b.elementName ?? null,
        category: b.category ?? null,
        title: b.title,
        body: b.body ?? "",
        status: b.status ?? "open",
      });
      return reply.code(201).send(toNote(q.getNote.get(id)));
    },
  );

  app.patch<{ Params: { id: string }; Body: NotePatch }>(
    "/api/notes/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          minProperties: 1,
          properties: { title: { type: "string", minLength: 1, maxLength: 255 }, body: { type: "string", maxLength: 20000 }, status },
        },
      },
    },
    async (req, reply) => {
      const current = q.getNote.get(req.params.id);
      if (!current) return reply.code(404).send({ error: "Note not found" });
      q.updateNote.run({
        id: req.params.id,
        title: req.body.title ?? current.title,
        body: req.body.body ?? current.body,
        status: req.body.status ?? current.status,
      });
      return toNote(q.getNote.get(req.params.id));
    },
  );

  app.delete<{ Params: { id: string } }>("/api/notes/:id", { schema: { params: idParams } }, async (req, reply) => {
    if (q.deleteNote.run(req.params.id).changes === 0) return reply.code(404).send({ error: "Note not found" });
    return reply.code(204).send();
  });

  // ---- Web app (production) ------------------------------------------------

  if (options.staticDir && existsSync(options.staticDir)) {
    await app.register(fastifyStatic, { root: options.staticDir });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0];
      // Client-side routes get the app; missing API routes and files (e.g. /assets/x.js) get a real 404.
      if (req.method !== "GET" || path.startsWith("/api/") || /\.[a-z0-9]+$/i.test(path)) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

// ---- SQL -------------------------------------------------------------------

interface ModelRow {
  id: string;
  name: string;
  file_name: string;
  size: number;
  element_count: number;
  created_at: string;
}
interface ElementRow {
  model_id: string;
  local_id: number;
  guid: string | null;
  category: string;
  name: string | null;
  storey: string | null;
  properties: string;
}
interface ViewRow {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
}
interface NoteRow {
  id: string;
  model_id: string;
  element_guid: string;
  element_name: string | null;
  category: string | null;
  title: string;
  body: string;
  status: NoteRecord["status"];
  created_at: string;
  updated_at: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function queries(db: Db) {
  return {
    listModels: db.prepare<[], ModelRow>("SELECT * FROM models ORDER BY created_at DESC"),
    getModel: db.prepare<[string], ModelRow>("SELECT * FROM models WHERE id = ?"),
    insertModel: db.prepare("INSERT INTO models (id, name, file_name, size) VALUES (@id, @name, @file_name, @size)"),
    deleteModel: db.prepare("DELETE FROM models WHERE id = ?"),
    setElementCount: db.prepare("UPDATE models SET element_count = ? WHERE id = ?"),

    deleteElements: db.prepare("DELETE FROM elements WHERE model_id = ?"),
    insertElement: db.prepare(
      `INSERT INTO elements (model_id, local_id, guid, category, name, storey, properties)
       VALUES (@model_id, @local_id, @guid, @category, @name, @storey, @properties)`,
    ),
    modelElements: db.prepare<[string], ElementRow>("SELECT * FROM elements WHERE model_id = ? ORDER BY category, name, local_id"),
    categories: db.prepare("SELECT category, COUNT(*) AS count FROM elements GROUP BY category ORDER BY count DESC"),
    categoriesOfModel: db.prepare(
      "SELECT category, COUNT(*) AS count FROM elements WHERE model_id = ? GROUP BY category ORDER BY count DESC",
    ),

    listViews: db.prepare<[], ViewRow>("SELECT * FROM views ORDER BY updated_at DESC"),
    getView: db.prepare<[string], ViewRow>("SELECT * FROM views WHERE id = ?"),
    insertView: db.prepare("INSERT INTO views (id, name, state) VALUES (@id, @name, @state)"),
    updateView: db.prepare(`UPDATE views SET name = @name, state = @state, updated_at = ${NOW} WHERE id = @id`),
    deleteView: db.prepare("DELETE FROM views WHERE id = ?"),

    getNote: db.prepare<[string], NoteRow>("SELECT * FROM notes WHERE id = ?"),
    insertNote: db.prepare(
      `INSERT INTO notes (id, model_id, element_guid, element_name, category, title, body, status)
       VALUES (@id, @model_id, @element_guid, @element_name, @category, @title, @body, @status)`,
    ),
    updateNote: db.prepare(`UPDATE notes SET title = @title, body = @body, status = @status, updated_at = ${NOW} WHERE id = @id`),
    deleteNote: db.prepare("DELETE FROM notes WHERE id = ?"),
  };
}

const toModel = (r: ModelRow | undefined): ModelRecord => ({
  id: r!.id,
  name: r!.name,
  fileName: r!.file_name,
  size: r!.size,
  elementCount: r!.element_count,
  createdAt: r!.created_at,
});

const toElement = (r: ElementRow): ElementRecord => ({
  localId: r.local_id,
  guid: r.guid,
  category: r.category,
  name: r.name,
  storey: r.storey,
  properties: JSON.parse(r.properties),
});

const toView = (r: ViewRow | undefined): ViewRecord => ({
  id: r!.id,
  name: r!.name,
  state: JSON.parse(r!.state),
  createdAt: r!.created_at,
  updatedAt: r!.updated_at,
});

const toNote = (r: NoteRow | undefined): NoteRecord => ({
  id: r!.id,
  modelId: r!.model_id,
  elementGuid: r!.element_guid,
  elementName: r!.element_name,
  category: r!.category,
  title: r!.title,
  body: r!.body,
  status: r!.status,
  createdAt: r!.created_at,
  updatedAt: r!.updated_at,
});

function safeFileName(name: string) {
  return name.replace(/\.(ifc|frag)$/i, "").replace(/[^\w.-]+/g, "_") || "model";
}

/** One row per element; property columns are "Pset.Property", unioned over all elements. */
export function toCsv(elements: ElementRecord[]) {
  const columns = new Map<string, [string, string]>();
  for (const e of elements) {
    for (const [set, props] of Object.entries(e.properties)) {
      for (const prop of Object.keys(props)) columns.set(JSON.stringify([set, prop]), [set, prop]);
    }
  }
  const sorted = [...columns.values()].sort((a, b) => `${a[0]}.${a[1]}`.localeCompare(`${b[0]}.${b[1]}`));
  const header = ["LocalId", "GlobalId", "Class", "Name", "Storey", ...sorted.map(([set, prop]) => `${set}.${prop}`)];
  const lines = [header.map(csvCell).join(",")];
  for (const e of elements) {
    const props = sorted.map(([set, prop]) => e.properties[set]?.[prop] ?? "");
    lines.push([e.localId, e.guid ?? "", e.category, e.name ?? "", e.storey ?? "", ...props].map(csvCell).join(","));
  }
  // BOM so Excel opens UTF-8 correctly.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function csvCell(value: unknown) {
  const s = String(value ?? "");
  // Neutralise formula-like cells (CSV injection) but keep plain numbers such as "-5" or "+3.2".
  const formula = /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s);
  const safe = formula ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
