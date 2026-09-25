import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AuthStatus, Project, ProjectMember, User } from "../../shared/api.ts";
import { DEFAULT_PROJECT_ID } from "../src/db.ts";
import { testServer } from "./helpers.ts";

describe("auth, users and projects", () => {
  let t: Awaited<ReturnType<typeof testServer>>;
  let admin: { cookie: string; user: User };
  before(async () => {
    t = await testServer();
  });
  after(async () => t.close());

  test("first run requires setup; the API is closed until then", async () => {
    const status = (await t.app.inject("/api/auth/status")).json() as AuthStatus;
    assert.deepEqual(status, { setupRequired: true, user: null });
    assert.equal((await t.app.inject("/api/models?projectId=" + DEFAULT_PROJECT_ID)).statusCode, 401);
    assert.equal((await t.app.inject("/api/health")).statusCode, 200);
  });

  test("setup creates the admin, signs in, and can only run once", async () => {
    admin = await t.setupAdmin();
    assert.equal(admin.user.role, "admin");
    const status = (await t.as(admin.cookie, "/api/auth/status")).json() as AuthStatus;
    assert.equal(status.setupRequired, false);
    assert.equal(status.user?.email, "admin@example.com");
    const again = await t.app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "x@example.com", name: "X", password: "password123" } });
    assert.equal(again.statusCode, 409);
    // The admin owns the default project that pre-existing data lives in.
    const projects = (await t.as(admin.cookie, "/api/projects")).json() as Project[];
    assert.ok(projects.some((p) => p.id === DEFAULT_PROJECT_ID && p.role === "owner"));
  });

  test("session cookie is httpOnly and SameSite=Strict", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "correct horse" } });
    assert.equal(res.statusCode, 200);
    const cookie = res.cookies.find((c) => c.name === "bim_session")!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Strict");
  });

  test("login rejects wrong passwords and unknown users the same way, and throttles", async () => {
    const wrong = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "nope" } });
    const unknown = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ghost@example.com", password: "nope" } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(unknown.statusCode, 401);
    assert.equal(wrong.json().error, unknown.json().error);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "throttle@example.com", password: "nope" } })).statusCode;
    }
    assert.equal(last, 429);
  });

  test("logout ends the session", async () => {
    const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "correct horse" } });
    const cookie = t.cookieOf(login);
    assert.equal((await t.as(cookie, { method: "POST", url: "/api/auth/logout" })).statusCode, 204);
    assert.equal((await t.as(cookie, "/api/projects")).statusCode, 401);
  });

  test("only admins manage users; members can't escalate themselves", async () => {
    const bob = await t.createMember(admin.cookie, "bob@example.com");
    assert.equal(bob.user.role, "member");
    const denied = await t.as(bob.cookie, { method: "POST", url: "/api/users", payload: { email: "eve@example.com", name: "Eve", password: "password123" } });
    assert.equal(denied.statusCode, 403);
    const escalate = await t.as(bob.cookie, { method: "PATCH", url: `/api/users/${bob.user.id}`, payload: { role: "admin" } });
    assert.equal(escalate.statusCode, 403);
    const rename = await t.as(bob.cookie, { method: "PATCH", url: `/api/users/${bob.user.id}`, payload: { name: "Bobby" } });
    assert.equal((rename.json() as User).name, "Bobby");
    const dup = await t.as(admin.cookie, { method: "POST", url: "/api/users", payload: { email: "BOB@example.com", name: "B", password: "password123" } });
    assert.equal(dup.statusCode, 409);
    // The last admin can't be demoted or delete themselves.
    assert.equal((await t.as(admin.cookie, { method: "PATCH", url: `/api/users/${admin.user.id}`, payload: { role: "member" } })).statusCode, 409);
    assert.equal((await t.as(admin.cookie, { method: "DELETE", url: `/api/users/${admin.user.id}` })).statusCode, 409);
  });

  test("password change signs out other sessions", async () => {
    const carol = await t.createMember(admin.cookie, "carol@example.com");
    const second = t.cookieOf(await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "carol@example.com", password: "password123" } }));
    const wrong = await t.as(carol.cookie, { method: "POST", url: "/api/auth/password", payload: { currentPassword: "bad", newPassword: "new-password-1" } });
    assert.equal(wrong.statusCode, 403);
    const ok = await t.as(carol.cookie, { method: "POST", url: "/api/auth/password", payload: { currentPassword: "password123", newPassword: "new-password-1" } });
    assert.equal(ok.statusCode, 204);
    assert.equal((await t.as(second, "/api/projects")).statusCode, 401);
    const relogin = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "carol@example.com", password: "new-password-1" } });
    assert.equal(relogin.statusCode, 200);
  });

  test("project membership and roles control access", async () => {
    const owner = await t.createMember(admin.cookie, "owner@example.com");
    const viewer = await t.createMember(admin.cookie, "viewer@example.com");
    const outsider = await t.createMember(admin.cookie, "outsider@example.com");
    const project = await t.createProject(owner.cookie, "Hospital");

    // Outsiders can't see the project or its models (404, not 403: no probing).
    assert.ok(!((await t.as(outsider.cookie, "/api/projects")).json() as Project[]).some((p) => p.id === project.id));
    assert.equal((await t.as(outsider.cookie, `/api/models?projectId=${project.id}`)).statusCode, 404);

    const added = await t.as(owner.cookie, { method: "PUT", url: `/api/projects/${project.id}/members`, payload: { userId: viewer.user.id, role: "viewer" } });
    assert.equal(added.statusCode, 200);
    assert.deepEqual(((added.json() as ProjectMember[]).map((m) => m.role)).sort(), ["owner", "viewer"]);

    // Viewers read but can't write.
    assert.equal((await t.as(viewer.cookie, `/api/models?projectId=${project.id}`)).statusCode, 200);
    assert.equal((await t.uploadModel(viewer.cookie, project.id)).statusCode, 403);
    assert.equal((await t.uploadModel(owner.cookie, project.id)).statusCode, 201);
    // Viewers can't manage members; the last owner can't be demoted or removed.
    assert.equal((await t.as(viewer.cookie, { method: "PUT", url: `/api/projects/${project.id}/members`, payload: { userId: outsider.user.id, role: "editor" } })).statusCode, 403);
    assert.equal((await t.as(owner.cookie, { method: "PUT", url: `/api/projects/${project.id}/members`, payload: { userId: owner.user.id, role: "editor" } })).statusCode, 409);
    assert.equal((await t.as(owner.cookie, { method: "DELETE", url: `/api/projects/${project.id}/members/${owner.user.id}` })).statusCode, 409);
    // Members can leave.
    assert.equal((await t.as(viewer.cookie, { method: "DELETE", url: `/api/projects/${project.id}/members/${viewer.user.id}` })).statusCode, 200);
    assert.equal((await t.as(viewer.cookie, `/api/models?projectId=${project.id}`)).statusCode, 404);

    // Admins see every project.
    assert.ok(((await t.as(admin.cookie, "/api/projects")).json() as Project[]).some((p) => p.id === project.id));

    // Renaming and deleting need ownership; deleting removes the models too.
    assert.equal((await t.as(outsider.cookie, { method: "PATCH", url: `/api/projects/${project.id}`, payload: { name: "X" } })).statusCode, 404);
    assert.equal(((await t.as(owner.cookie, { method: "PATCH", url: `/api/projects/${project.id}`, payload: { name: "Hospital B" } })).json() as Project).name, "Hospital B");
    assert.equal((await t.as(owner.cookie, { method: "DELETE", url: `/api/projects/${project.id}` })).statusCode, 204);
    assert.equal((await t.as(owner.cookie, `/api/models?projectId=${project.id}`)).statusCode, 404);
  });
});
