import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Project, ProjectMember } from "../../../shared/api.ts";
import { can } from "../../../shared/permissions.ts";
import { HttpError, requirePermission, requireProject, requireUser } from "../auth.ts";
import { ID, idParams, type RouteContext } from "./context.ts";

const name = { type: "string", minLength: 1, maxLength: 200 } as const;
const ONLY_ADMINS = "Only administrators can manage projects";

export function projectRoutes({ db, dataDir }: RouteContext) {
  const members = (projectId: string): ProjectMember[] =>
    db
      .prepare(
        `SELECT m.user_id AS userId, u.name, u.email, u.role FROM project_members m JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE`,
      )
      .all(projectId) as ProjectMember[];

  const getProject = (id: string) => db.prepare("SELECT id, name, created_at AS createdAt FROM projects WHERE id = ?").get(id) as Project;

  return async (app: FastifyInstance) => {
    // Admins see every project; everyone else the projects they're members of.
    app.get("/api/projects", async (req): Promise<Project[]> => {
      const user = requireUser(req);
      return can(user.role, "projects.seeAll")
        ? (db.prepare("SELECT id, name, created_at AS createdAt FROM projects ORDER BY name COLLATE NOCASE").all() as Project[])
        : (db
            .prepare(
              `SELECT p.id, p.name, p.created_at AS createdAt FROM projects p
               JOIN project_members m ON m.project_id = p.id WHERE m.user_id = ? ORDER BY p.name COLLATE NOCASE`,
            )
            .all(user.id) as Project[]);
    });

    app.post<{ Body: { name: string } }>(
      "/api/projects",
      { schema: { body: { type: "object", required: ["name"], properties: { name } } } },
      async (req, reply) => {
        const user = requirePermission(req, "projects.manage", ONLY_ADMINS);
        const id = randomUUID();
        db.transaction(() => {
          db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, req.body.name.trim());
          // The creator is listed as a member, so the project keeps a contact if their role changes.
          db.prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)").run(id, user.id);
        })();
        return reply.code(201).send(getProject(id));
      },
    );

    app.patch<{ Params: { id: string }; Body: { name: string } }>(
      "/api/projects/:id",
      { schema: { params: idParams, body: { type: "object", required: ["name"], properties: { name } } } },
      async (req) => {
        requireProject(db, req, req.params.id, "projects.manage");
        db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(req.body.name.trim(), req.params.id);
        return getProject(req.params.id);
      },
    );

    // Deletes the project with its models (and their files), views and issues.
    app.delete<{ Params: { id: string } }>("/api/projects/:id", { schema: { params: idParams } }, async (req, reply) => {
      requireProject(db, req, req.params.id, "projects.manage");
      const modelIds = (db.prepare("SELECT id FROM models WHERE project_id = ?").all(req.params.id) as { id: string }[]).map((m) => m.id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
      await Promise.all(modelIds.map((id) => rm(join(dataDir, "models", `${id}.frag`), { force: true })));
      return reply.code(204).send();
    });

    app.get<{ Params: { id: string } }>("/api/projects/:id/members", { schema: { params: idParams } }, async (req) => {
      requireProject(db, req, req.params.id);
      return members(req.params.id);
    });

    // Adds a member. What they may do comes from their account role.
    app.put<{ Params: { id: string }; Body: { userId: string } }>(
      "/api/projects/:id/members",
      { schema: { params: idParams, body: { type: "object", required: ["userId"], properties: { userId: ID } } } },
      async (req) => {
        requireProject(db, req, req.params.id, "projects.manage");
        if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(req.body.userId)) throw new HttpError(404, "User not found");
        db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)").run(req.params.id, req.body.userId);
        return members(req.params.id);
      },
    );

    app.delete<{ Params: { id: string; userId: string } }>(
      "/api/projects/:id/members/:userId",
      { schema: { params: { type: "object", required: ["id", "userId"], properties: { id: ID, userId: ID } } } },
      async (req) => {
        const { user } = requireProject(db, req, req.params.id);
        // Admins remove anyone; everyone can leave a project.
        if (user.id !== req.params.userId && !can(user.role, "projects.manage")) throw new HttpError(403, ONLY_ADMINS);
        const removed = db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
        if (!removed.changes) throw new HttpError(404, "Not a member");
        return members(req.params.id);
      },
    );
  };
}
