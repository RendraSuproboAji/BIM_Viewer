import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { PROJECT_ROLES, type Project, type ProjectMember, type ProjectRole } from "../../../shared/api.ts";
import { HttpError, requireProject, requireUser } from "../auth.ts";
import { ID, idParams, type RouteContext } from "./context.ts";

const role = { type: "string", enum: [...PROJECT_ROLES] } as const;
const name = { type: "string", minLength: 1, maxLength: 200 } as const;

export function projectRoutes({ db, dataDir }: RouteContext) {
  const memberCountOfRole = (projectId: string, r: ProjectRole) =>
    (db.prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = ?").get(projectId, r) as { n: number }).n;

  const members = (projectId: string): ProjectMember[] =>
    db
      .prepare(
        `SELECT m.user_id AS userId, u.name, u.email, m.role FROM project_members m JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE`,
      )
      .all(projectId) as ProjectMember[];

  return async (app: FastifyInstance) => {
    app.get("/api/projects", async (req): Promise<Project[]> => {
      const user = requireUser(req);
      const rows =
        user.role === "admin"
          ? (db.prepare("SELECT id, name, created_at AS createdAt, 'owner' AS role FROM projects ORDER BY name COLLATE NOCASE").all() as Project[])
          : (db
              .prepare(
                `SELECT p.id, p.name, p.created_at AS createdAt, m.role FROM projects p
                 JOIN project_members m ON m.project_id = p.id WHERE m.user_id = ? ORDER BY p.name COLLATE NOCASE`,
              )
              .all(user.id) as Project[]);
      return rows;
    });

    app.post<{ Body: { name: string } }>(
      "/api/projects",
      { schema: { body: { type: "object", required: ["name"], properties: { name } } } },
      async (req, reply) => {
        const user = requireUser(req);
        const id = randomUUID();
        db.transaction(() => {
          db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, req.body.name.trim());
          db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").run(id, user.id);
        })();
        return reply.code(201).send({ id, name: req.body.name.trim(), createdAt: new Date().toISOString(), role: "owner" } satisfies Project);
      },
    );

    app.patch<{ Params: { id: string }; Body: { name: string } }>(
      "/api/projects/:id",
      { schema: { params: idParams, body: { type: "object", required: ["name"], properties: { name } } } },
      async (req) => {
        const { role: myRole } = requireProject(db, req, req.params.id, "owner");
        db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(req.body.name.trim(), req.params.id);
        const row = db.prepare("SELECT id, name, created_at AS createdAt FROM projects WHERE id = ?").get(req.params.id) as Omit<Project, "role">;
        return { ...row, role: myRole } satisfies Project;
      },
    );

    // Deletes the project with its models (and their files), views and issues.
    app.delete<{ Params: { id: string } }>("/api/projects/:id", { schema: { params: idParams } }, async (req, reply) => {
      requireProject(db, req, req.params.id, "owner");
      const modelIds = (db.prepare("SELECT id FROM models WHERE project_id = ?").all(req.params.id) as { id: string }[]).map((m) => m.id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
      await Promise.all(modelIds.map((id) => rm(join(dataDir, "models", `${id}.frag`), { force: true })));
      return reply.code(204).send();
    });

    app.get<{ Params: { id: string } }>("/api/projects/:id/members", { schema: { params: idParams } }, async (req) => {
      requireProject(db, req, req.params.id, "viewer");
      return members(req.params.id);
    });

    // Adds a member or changes their role.
    app.put<{ Params: { id: string }; Body: { userId: string; role: ProjectRole } }>(
      "/api/projects/:id/members",
      { schema: { params: idParams, body: { type: "object", required: ["userId", "role"], properties: { userId: ID, role } } } },
      async (req) => {
        requireProject(db, req, req.params.id, "owner");
        if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(req.body.userId)) throw new HttpError(404, "User not found");
        const current = db
          .prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
          .get(req.params.id, req.body.userId) as { role: ProjectRole } | undefined;
        if (current?.role === "owner" && req.body.role !== "owner" && memberCountOfRole(req.params.id, "owner") <= 1) {
          throw new HttpError(409, "A project needs at least one owner");
        }
        db.prepare(
          `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
           ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
        ).run(req.params.id, req.body.userId, req.body.role);
        return members(req.params.id);
      },
    );

    app.delete<{ Params: { id: string; userId: string } }>(
      "/api/projects/:id/members/:userId",
      { schema: { params: { type: "object", required: ["id", "userId"], properties: { id: ID, userId: ID } } } },
      async (req) => {
        const { user } = requireProject(db, req, req.params.id, "viewer");
        // Owners can remove anyone; everyone can leave a project.
        if (user.id !== req.params.userId) requireProject(db, req, req.params.id, "owner");
        const current = db
          .prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
          .get(req.params.id, req.params.userId) as { role: ProjectRole } | undefined;
        if (!current) throw new HttpError(404, "Not a member");
        if (current.role === "owner" && memberCountOfRole(req.params.id, "owner") <= 1) throw new HttpError(409, "A project needs at least one owner");
        db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
        return members(req.params.id);
      },
    );
  };
}
