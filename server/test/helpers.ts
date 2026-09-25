import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectOptions } from "fastify";
import type { Project, User } from "../../shared/api.ts";
import { buildApp } from "../src/app.ts";

/** A test server with a temp data dir, plus helpers to act as signed-in users. */
export async function testServer(options: { staticDir?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bim-api-"));
  const app = await buildApp({ dbFile: join(dir, "test.sqlite"), dataDir: dir, ...options });

  async function as(cookie: string | null, opts: InjectOptions | string) {
    const o: InjectOptions = typeof opts === "string" ? { url: opts } : opts;
    return app.inject({ ...o, headers: { ...(o.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  }
  const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === "bim_session");
    if (!c) throw new Error("no session cookie");
    return `bim_session=${c.value}`;
  };

  /** Creates the admin via first-run setup. */
  async function setupAdmin(email = "admin@example.com") {
    const res = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email, name: "Admin", password: "correct horse" } });
    if (res.statusCode !== 201) throw new Error(res.body);
    return { cookie: cookieOf(res), user: res.json() as User };
  }

  /** Admin creates a member and signs them in. */
  async function createMember(adminCookie: string, email: string, name = email.split("@")[0]) {
    const created = await as(adminCookie, { method: "POST", url: "/api/users", payload: { email, name, password: "password123" } });
    if (created.statusCode !== 201) throw new Error(created.body);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
    return { cookie: cookieOf(login), user: created.json() as User };
  }

  async function createProject(cookie: string, name = "Tower A") {
    const res = await as(cookie, { method: "POST", url: "/api/projects", payload: { name } });
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json() as Project;
  }

  async function uploadModel(cookie: string, projectId: string, name = "house.ifc", bytes = Buffer.from([1, 2, 3, 4])) {
    return as(cookie, {
      method: "POST",
      url: `/api/models?projectId=${projectId}&name=${encodeURIComponent(name)}`,
      headers: { "content-type": "application/octet-stream" },
      payload: bytes,
    });
  }

  return {
    app,
    dir,
    as,
    cookieOf,
    setupAdmin,
    createMember,
    createProject,
    uploadModel,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Smallest valid PNG (1x1), base64. */
export const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
