import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User, UserRole } from "../../shared/api.ts";
import { can, type Permission } from "../../shared/permissions.ts";
import type { Db } from "./db.ts";

// ---- Passwords (scrypt, per-user salt) ----------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = SCRYPT;
  const key = await scrypt(password, salt, keyLength, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, N, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

/** A precomputed hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing). */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(16).toString("hex"));

export const PASSWORD_MIN_LENGTH = 8;

// ---- Sessions ------------------------------------------------------------------------------------

export const SESSION_COOKIE = "bim_session";
export const SESSION_DAYS = 30;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires);
  // Opportunistic cleanup of expired sessions.
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return { token, expires: new Date(expires) };
}

export function deleteSession(db: Db, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
  password_hash: string;
}

export const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at });

export function userForToken(db: Db, token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare<[string, string], UserRow>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), new Date().toISOString());
  return row ? toUser(row) : null;
}

export function findUserByEmail(db: Db, email: string) {
  return db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?").get(email);
}

// ---- Login throttling ----------------------------------------------------------------------------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

/** Throttles repeated failed logins per e-mail + IP. */
export function loginBlocked(key: string) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordLoginFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count++;
}

export function clearLoginFailures(key: string) {
  failures.delete(key);
}

// ---- Request helpers -----------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, "Please sign in");
  return req.user;
}

/** Checks the signed-in user's role grants a permission (403 otherwise). */
export function requirePermission(req: FastifyRequest, permission: Permission, message = "Your role doesn't allow this"): User {
  const user = requireUser(req);
  if (!can(user.role, permission)) throw new HttpError(403, message);
  return user;
}

export function requireAdmin(req: FastifyRequest): User {
  return requirePermission(req, "users.manage", "Only administrators can do this");
}

/** Whether a user may see a project: admins see all, others only projects they're members of. */
export function hasProjectAccess(db: Db, user: User, projectId: string) {
  if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) return false;
  if (can(user.role, "projects.seeAll")) return true;
  return !!db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, user.id);
}

const ROLE_DENIED: Record<UserRole, string> = {
  admin: "Not allowed",
  editor: "Editors can't do this",
  client: "Clients can view, comment and raise issues, but can't change this",
};

/**
 * Checks the user can see a project and, when given, that their role grants `permission`.
 * Non-members get 404 (not 403) so project ids can't be probed.
 */
export function requireProject(db: Db, req: FastifyRequest, projectId: string | undefined, permission?: Permission) {
  const user = requireUser(req);
  if (!projectId || !hasProjectAccess(db, user, projectId)) throw new HttpError(404, "Project not found");
  if (permission && !can(user.role, permission)) throw new HttpError(403, ROLE_DENIED[user.role]);
  return { user };
}

export function sendError(reply: FastifyReply, error: HttpError) {
  return reply.code(error.statusCode).send({ error: error.message });
}
