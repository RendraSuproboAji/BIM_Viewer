import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStatus, User, UserRole } from "../../../shared/api.ts";
import { can, ROLES } from "../../../shared/permissions.ts";
import {
  clearLoginFailures,
  createSession,
  deleteSession,
  DUMMY_HASH_PROMISE,
  findUserByEmail,
  hashPassword,
  HttpError,
  loginBlocked,
  PASSWORD_MIN_LENGTH,
  recordLoginFailure,
  requireAdmin,
  requireUser,
  SESSION_COOKIE,
  toUser,
  verifyPassword,
} from "../auth.ts";
import { DEFAULT_PROJECT_ID } from "../db.ts";
import { idParams, type RouteContext } from "./context.ts";

const email = { type: "string", format: "email", maxLength: 254 } as const;
const password = { type: "string", minLength: PASSWORD_MIN_LENGTH, maxLength: 200 } as const;
const name = { type: "string", minLength: 1, maxLength: 120 } as const;
const role = { type: "string", enum: [...ROLES] } as const;

export function authRoutes({ db }: RouteContext) {
  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const getUser = (id: string) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Parameters<typeof toUser>[0] | undefined;
    return row ? toUser(row) : null;
  };

  function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const { token, expires } = createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      // Strict: the cookie is never sent on cross-site requests (CSRF protection).
      sameSite: "strict",
      secure: req.protocol === "https",
      expires,
    });
  }

  async function createUser(input: { email: string; name: string; password: string; role: UserRole }) {
    if (findUserByEmail(db, input.email)) throw new HttpError(409, "A user with this e-mail already exists");
    const id = randomUUID();
    db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.email.trim(),
      input.name.trim(),
      await hashPassword(input.password),
      input.role,
    );
    return id;
  }

  return async (app: FastifyInstance) => {
    app.get("/api/auth/status", async (req): Promise<AuthStatus> => ({ setupRequired: userCount() === 0, user: req.user }));

    // First run: creates the administrator. Refused once any user exists.
    app.post<{ Body: { email: string; name: string; password: string } }>(
      "/api/auth/setup",
      { schema: { body: { type: "object", required: ["email", "name", "password"], properties: { email, name, password } } } },
      async (req, reply) => {
        // Hash first (async), then check-and-insert in one synchronous transaction,
        // so two simultaneous setup requests can't both create an administrator.
        const passwordHash = await hashPassword(req.body.password);
        const id = randomUUID();
        db.transaction(() => {
          if (userCount() > 0) throw new HttpError(409, "Setup has already been completed");
          db.prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'admin')").run(
            id,
            req.body.email.trim(),
            req.body.name.trim(),
            passwordHash,
          );
        })();
        // The first admin is listed on the project that pre-existing data was migrated into.
        db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)").run(DEFAULT_PROJECT_ID, id);
        startSession(req, reply, id);
        return reply.code(201).send(getUser(id));
      },
    );

    app.post<{ Body: { email: string; password: string } }>(
      "/api/auth/login",
      {
        schema: {
          body: { type: "object", required: ["email", "password"], properties: { email: { type: "string", maxLength: 254 }, password: { type: "string", maxLength: 200 } } },
        },
      },
      async (req, reply) => {
        const key = `${req.body.email.toLowerCase()}|${req.ip}`;
        if (loginBlocked(key)) throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
        const row = findUserByEmail(db, req.body.email.trim());
        // Always run scrypt, so response time doesn't reveal whether the e-mail exists.
        const ok = await verifyPassword(req.body.password, row?.password_hash ?? (await DUMMY_HASH_PROMISE));
        if (!row || !ok) {
          recordLoginFailure(key);
          throw new HttpError(401, "Wrong e-mail or password");
        }
        clearLoginFailures(key);
        startSession(req, reply, row.id);
        return toUser(row);
      },
    );

    app.post("/api/auth/logout", async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) deleteSession(db, token);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(204).send();
    });

    app.post<{ Body: { currentPassword: string; newPassword: string } }>(
      "/api/auth/password",
      {
        schema: {
          body: {
            type: "object",
            required: ["currentPassword", "newPassword"],
            properties: { currentPassword: { type: "string", maxLength: 200 }, newPassword: password },
          },
        },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const row = findUserByEmail(db, user.email)!;
        if (!(await verifyPassword(req.body.currentPassword, row.password_hash))) throw new HttpError(403, "Current password is wrong");
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(req.body.newPassword), user.id);
        // Sign out other sessions.
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        startSession(req, reply, user.id);
        return reply.code(204).send();
      },
    );

    // ---- Users -------------------------------------------------------------------------------

    // Admins see every account. Everyone else sees the people they share a project with
    // (and the admins), which is who they can assign issues to: a client doesn't learn
    // about other clients' projects.
    app.get("/api/users", async (req): Promise<User[]> => {
      const me = requireUser(req);
      const rows = can(me.role, "users.manage")
        ? db.prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all()
        : db
            .prepare(
              `SELECT * FROM users u WHERE u.id = @me OR u.role = 'admin' OR EXISTS (
                 SELECT 1 FROM project_members mine JOIN project_members theirs ON theirs.project_id = mine.project_id
                 WHERE mine.user_id = @me AND theirs.user_id = u.id)
               ORDER BY u.name COLLATE NOCASE`,
            )
            .all({ me: me.id });
      return (rows as Parameters<typeof toUser>[0][]).map(toUser);
    });

    app.post<{ Body: { email: string; name: string; password: string; role?: UserRole } }>(
      "/api/users",
      { schema: { body: { type: "object", required: ["email", "name", "password"], properties: { email, name, password, role } } } },
      async (req, reply) => {
        requireAdmin(req);
        // Least privilege by default; new accounts see no projects until an admin adds them.
        const id = await createUser({ ...req.body, role: req.body.role ?? "client" });
        return reply.code(201).send(getUser(id));
      },
    );

    app.patch<{ Params: { id: string }; Body: { name?: string; role?: UserRole; password?: string } }>(
      "/api/users/:id",
      { schema: { params: idParams, body: { type: "object", minProperties: 1, properties: { name, role, password } } } },
      async (req) => {
        const me = requireUser(req);
        const target = getUser(req.params.id);
        if (!target) throw new HttpError(404, "User not found");
        const isAdmin = can(me.role, "users.manage");
        if (!isAdmin && me.id !== target.id) throw new HttpError(403, "You can only change your own account");
        if (req.body.role && !isAdmin) throw new HttpError(403, "Only administrators can change roles");
        if (req.body.password && !isAdmin) throw new HttpError(403, "Use the change-password form");
        if (req.body.role && req.body.role !== "admin" && target.role === "admin") {
          const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
          if (admins <= 1) throw new HttpError(409, "There must be at least one administrator");
        }
        if (req.body.name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(req.body.name.trim(), target.id);
        if (req.body.role) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(req.body.role, target.id);
        if (req.body.password) {
          db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(req.body.password), target.id);
          db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        }
        return getUser(target.id);
      },
    );

    app.delete<{ Params: { id: string } }>("/api/users/:id", { schema: { params: idParams } }, async (req, reply) => {
      const me = requireAdmin(req);
      if (me.id === req.params.id) throw new HttpError(409, "You can't delete your own account");
      if (db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id).changes === 0) throw new HttpError(404, "User not found");
      return reply.code(204).send();
    });
  };
}
