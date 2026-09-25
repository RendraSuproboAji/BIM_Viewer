import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ProjectRole, ViewRecord, ViewState } from "../../../shared/api.ts";
import { HttpError, requireProject } from "../auth.ts";
import { ID, idParams, NOW, type RouteContext } from "./context.ts";

interface ViewRow {
  id: string;
  project_id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
}

const toView = (r: ViewRow): ViewRecord => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  state: JSON.parse(r.state),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } as const;

/** Full schema: a malformed view would break the client when restored. */
export const viewStateSchema = {
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
} as const;

const name = { type: "string", minLength: 1, maxLength: 255 } as const;

export function viewRoutes({ db }: RouteContext) {
  function accessView(req: FastifyRequest, id: string, minimum: ProjectRole) {
    const row = db.prepare<[string], ViewRow>("SELECT * FROM views WHERE id = ?").get(id);
    if (!row) throw new HttpError(404, "View not found");
    try {
      requireProject(db, req, row.project_id, minimum);
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 404) throw new HttpError(404, "View not found");
      throw e;
    }
    return row;
  }

  return async (app: FastifyInstance) => {
    app.get<{ Querystring: { projectId: string } }>(
      "/api/views",
      { schema: { querystring: { type: "object", required: ["projectId"], properties: { projectId: ID } } } },
      async (req) => {
        requireProject(db, req, req.query.projectId, "viewer");
        return (db.prepare("SELECT * FROM views WHERE project_id = ? ORDER BY updated_at DESC").all(req.query.projectId) as ViewRow[]).map(toView);
      },
    );

    app.post<{ Body: { projectId: string; name: string; state: ViewState } }>(
      "/api/views",
      { schema: { body: { type: "object", required: ["projectId", "name", "state"], properties: { projectId: ID, name, state: viewStateSchema } } } },
      async (req, reply) => {
        requireProject(db, req, req.body.projectId, "editor");
        const id = randomUUID();
        db.prepare("INSERT INTO views (id, project_id, name, state) VALUES (?, ?, ?, ?)").run(id, req.body.projectId, req.body.name, JSON.stringify(req.body.state));
        return reply.code(201).send(toView(db.prepare<[string], ViewRow>("SELECT * FROM views WHERE id = ?").get(id)!));
      },
    );

    app.put<{ Params: { id: string }; Body: { name: string; state: ViewState } }>(
      "/api/views/:id",
      { schema: { params: idParams, body: { type: "object", required: ["name", "state"], properties: { name, state: viewStateSchema } } } },
      async (req) => {
        accessView(req, req.params.id, "editor");
        db.prepare(`UPDATE views SET name = ?, state = ?, updated_at = ${NOW} WHERE id = ?`).run(req.body.name, JSON.stringify(req.body.state), req.params.id);
        return toView(db.prepare<[string], ViewRow>("SELECT * FROM views WHERE id = ?").get(req.params.id)!);
      },
    );

    app.delete<{ Params: { id: string } }>("/api/views/:id", { schema: { params: idParams } }, async (req, reply) => {
      accessView(req, req.params.id, "editor");
      db.prepare("DELETE FROM views WHERE id = ?").run(req.params.id);
      return reply.code(204).send();
    });
  };
}
