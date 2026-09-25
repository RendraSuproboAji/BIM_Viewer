import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CategoryCount, ElementRecord, ElementSearchResponse, ModelRecord } from "../../../shared/api.ts";
import type { Permission } from "../../../shared/permissions.ts";
import { HttpError, requireProject } from "../auth.ts";
import { safeFileName, toCsv } from "../csv.ts";
import { ID, idParams, type RouteContext } from "./context.ts";

interface ModelRow {
  id: string;
  project_id: string;
  name: string;
  file_name: string;
  size: number;
  element_count: number;
  created_at: string;
}
export interface ElementRow {
  model_id: string;
  local_id: number;
  guid: string | null;
  category: string;
  name: string | null;
  storey: string | null;
  properties: string;
}

export const toModel = (r: ModelRow): ModelRecord => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  fileName: r.file_name,
  size: r.size,
  elementCount: r.element_count,
  createdAt: r.created_at,
});

export const toElement = (r: ElementRow): ElementRecord => ({
  localId: r.local_id,
  guid: r.guid,
  category: r.category,
  name: r.name,
  storey: r.storey,
  properties: JSON.parse(r.properties),
});

const projectQuery = { type: "object", required: ["projectId"], properties: { projectId: ID } } as const;

export function modelRoutes({ db, dataDir, bodyLimit }: RouteContext) {
  const modelFile = (id: string) => join(dataDir, "models", `${id}.frag`);
  const getModel = db.prepare<[string], ModelRow>("SELECT * FROM models WHERE id = ?");

  /** Loads a model and checks the user's rights on its project (404 if either is missing). */
  function accessModel(req: FastifyRequest, id: string, permission?: Permission) {
    const row = getModel.get(id);
    if (!row) throw new HttpError(404, "Model not found");
    try {
      requireProject(db, req, row.project_id, permission);
    } catch (e) {
      // Don't reveal that a model exists in a project the user can't see.
      if (e instanceof HttpError && e.statusCode === 404) throw new HttpError(404, "Model not found");
      throw e;
    }
    return row;
  }

  return async (app: FastifyInstance) => {
    app.get<{ Querystring: { projectId: string } }>("/api/models", { schema: { querystring: projectQuery } }, async (req) => {
      requireProject(db, req, req.query.projectId);
      return (db.prepare("SELECT * FROM models WHERE project_id = ? ORDER BY created_at DESC").all(req.query.projectId) as ModelRow[]).map(toModel);
    });

    app.post<{ Querystring: { projectId: string; name: string; fileName?: string }; Body: Buffer }>(
      "/api/models",
      {
        bodyLimit,
        schema: {
          querystring: {
            type: "object",
            required: ["projectId", "name"],
            properties: { projectId: ID, name: { type: "string", minLength: 1, maxLength: 255 }, fileName: { type: "string", maxLength: 255 } },
          },
        },
      },
      async (req, reply) => {
        requireProject(db, req, req.query.projectId, "models.write");
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "Send the .frag bytes as application/octet-stream");
        const id = randomUUID();
        await writeFile(modelFile(id), req.body);
        try {
          db.prepare("INSERT INTO models (id, project_id, name, file_name, size) VALUES (?, ?, ?, ?, ?)").run(
            id,
            req.query.projectId,
            req.query.name,
            req.query.fileName ?? `${req.query.name}.frag`,
            req.body.length,
          );
        } catch (e) {
          await rm(modelFile(id), { force: true }); // no orphaned files
          throw e;
        }
        return reply.code(201).send(toModel(getModel.get(id)!));
      },
    );

    app.get<{ Params: { id: string } }>("/api/models/:id", { schema: { params: idParams } }, async (req) => toModel(accessModel(req, req.params.id)));

    app.get<{ Params: { id: string } }>("/api/models/:id/file", { schema: { params: idParams } }, async (req, reply) => {
      accessModel(req, req.params.id);
      const file = modelFile(req.params.id);
      if (!existsSync(file)) throw new HttpError(404, "Model file not found");
      // Streamed, so large models are never held in memory.
      return reply.type("application/octet-stream").header("content-length", (await stat(file)).size).send(createReadStream(file));
    });

    app.delete<{ Params: { id: string } }>("/api/models/:id", { schema: { params: idParams } }, async (req, reply) => {
      accessModel(req, req.params.id, "models.write");
      // Elements go with it; issues keep their components but lose the model link.
      db.prepare("DELETE FROM models WHERE id = ?").run(req.params.id);
      await rm(modelFile(req.params.id), { force: true });
      return reply.code(204).send();
    });

    // ---- Extracted BIM data ------------------------------------------------------------------

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
      async (req) => {
        const modelId = accessModel(req, req.params.id, "models.write").id;
        // Replace the whole set atomically so re-saving a model never leaves stale rows.
        const insert = db.prepare(
          `INSERT INTO elements (model_id, local_id, guid, category, name, storey, properties)
           VALUES (@model_id, @local_id, @guid, @category, @name, @storey, @properties)`,
        );
        db.transaction((elements: ElementRecord[]) => {
          db.prepare("DELETE FROM elements WHERE model_id = ?").run(modelId);
          for (const e of elements) {
            insert.run({
              model_id: modelId,
              local_id: e.localId,
              guid: e.guid ?? null,
              category: e.category,
              name: e.name ?? null,
              storey: e.storey ?? null,
              properties: JSON.stringify(e.properties ?? {}),
            });
          }
          db.prepare("UPDATE models SET element_count = ? WHERE id = ?").run(elements.length, modelId);
        })(req.body.elements);
        return { count: req.body.elements.length };
      },
    );

    app.get<{ Params: { id: string } }>("/api/models/:id/elements.csv", { schema: { params: idParams } }, async (req, reply) => {
      const model = accessModel(req, req.params.id);
      const rows = (db.prepare("SELECT * FROM elements WHERE model_id = ? ORDER BY category, name, local_id").all(model.id) as ElementRow[]).map(toElement);
      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${safeFileName(model.name)}-elements.csv"`)
        .send(toCsv(rows));
    });

    app.get<{ Querystring: { projectId: string; q?: string; category?: string; modelId?: string; limit?: number; offset?: number } }>(
      "/api/elements",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["projectId"],
            properties: {
              projectId: ID,
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
        requireProject(db, req, req.query.projectId);
        const { q: text, category, modelId, limit = 50, offset = 0 } = req.query;
        const where = ["m.project_id = @projectId"];
        const params: Record<string, unknown> = { projectId: req.query.projectId, limit, offset };
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
        const clause = `WHERE ${where.join(" AND ")}`;
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM elements e JOIN models m ON m.id = e.model_id ${clause}`).get(params) as { n: number }).n;
        const rows = db
          .prepare(
            `SELECT e.*, m.name AS model_name FROM elements e JOIN models m ON m.id = e.model_id ${clause}
             ORDER BY m.name, e.category, e.name, e.local_id LIMIT @limit OFFSET @offset`,
          )
          .all(params) as (ElementRow & { model_name: string })[];
        return { total, items: rows.map((r) => ({ ...toElement(r), modelId: r.model_id, modelName: r.model_name })) };
      },
    );

    app.get<{ Querystring: { projectId: string; modelId?: string } }>(
      "/api/elements/categories",
      { schema: { querystring: { type: "object", required: ["projectId"], properties: { projectId: ID, modelId: ID } } } },
      async (req): Promise<CategoryCount[]> => {
        requireProject(db, req, req.query.projectId);
        const byModel = req.query.modelId ? "AND e.model_id = @modelId" : "";
        return db
          .prepare(
            `SELECT e.category, COUNT(*) AS count FROM elements e JOIN models m ON m.id = e.model_id
             WHERE m.project_id = @projectId ${byModel} GROUP BY e.category ORDER BY count DESC`,
          )
          .all({ projectId: req.query.projectId, modelId: req.query.modelId }) as CategoryCount[];
      },
    );
  };
}
