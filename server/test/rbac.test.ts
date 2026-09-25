import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { IssueDetail, ModelRecord, Project, ProjectMember, User, ViewRecord } from "../../shared/api.ts";
import { testServer } from "./helpers.ts";

/** A minimal valid saved-view state. */
const VIEW_STATE = {
  camera: { position: [10, 10, 10], target: [0, 0, 0] },
  section: { enabled: false, axis: "y", offset: 0.5, flipped: false },
  hiddenClasses: [],
  ghost: false,
  models: [],
} as const;

describe("role-based access control (admin / editor / client)", () => {
  let t: Awaited<ReturnType<typeof testServer>>;
  let admin: { cookie: string; user: User };
  let editor: { cookie: string; user: User };
  let client: { cookie: string; user: User };
  let outsider: { cookie: string; user: User };
  let project: Project;
  let model: ModelRecord;

  before(async () => {
    t = await testServer();
    admin = await t.setupAdmin();
    editor = await t.createMember(admin.cookie, "editor@example.com", "editor");
    client = await t.createMember(admin.cookie, "client@example.com", "client");
    // An editor who is not on the project: roles never grant access to other projects.
    outsider = await t.createMember(admin.cookie, "outsider@example.com", "editor");
    project = await t.createProject(admin.cookie, "Tower A");
    await t.addMember(admin.cookie, project.id, editor.user.id);
    await t.addMember(admin.cookie, project.id, client.user.id);
    model = (await t.uploadModel(editor.cookie, project.id)).json() as ModelRecord;
  });
  after(async () => t.close());

  const status = async (cookie: string, opts: Parameters<typeof t.as>[1]) => (await t.as(cookie, opts)).statusCode;

  test("only admins manage users, projects and members", async () => {
    for (const who of [editor, client]) {
      assert.equal(await status(who.cookie, { method: "POST", url: "/api/users", payload: { email: `x-${who.user.id}@example.com`, name: "X", password: "password123" } }), 403);
      assert.equal(await status(who.cookie, { method: "POST", url: "/api/projects", payload: { name: "Mine" } }), 403);
      assert.equal(await status(who.cookie, { method: "PATCH", url: `/api/projects/${project.id}`, payload: { name: "Renamed" } }), 403);
      assert.equal(await status(who.cookie, { method: "DELETE", url: `/api/projects/${project.id}` }), 403);
      assert.equal(await status(who.cookie, { method: "PUT", url: `/api/projects/${project.id}/members`, payload: { userId: outsider.user.id } }), 403);
      assert.equal(await status(who.cookie, { method: "DELETE", url: `/api/projects/${project.id}/members/${editor.user.id === who.user.id ? client.user.id : editor.user.id}` }), 403);
      // Nobody changes their own role.
      assert.equal(await status(who.cookie, { method: "PATCH", url: `/api/users/${who.user.id}`, payload: { role: "admin" } }), 403);
    }
  });

  test("members see their projects; everyone else gets 404", async () => {
    for (const who of [editor, client]) {
      assert.ok(((await t.as(who.cookie, "/api/projects")).json() as Project[]).some((p) => p.id === project.id));
      assert.equal(await status(who.cookie, `/api/models?projectId=${project.id}`), 200);
    }
    assert.equal(((await t.as(outsider.cookie, "/api/projects")).json() as Project[]).length, 0);
    assert.equal(await status(outsider.cookie, `/api/models?projectId=${project.id}`), 404);
    assert.equal(await status(outsider.cookie, `/api/models/${model.id}/file`), 404);
    // Admins see every project without being members.
    const other = await t.createProject(admin.cookie, "Other");
    await t.as(admin.cookie, { method: "DELETE", url: `/api/projects/${other.id}/members/${admin.user.id}` });
    assert.ok(((await t.as(admin.cookie, "/api/projects")).json() as Project[]).some((p) => p.id === other.id));
  });

  test("members list shows each member's account role", async () => {
    const members = (await t.as(client.cookie, `/api/projects/${project.id}/members`)).json() as ProjectMember[];
    const roles = Object.fromEntries(members.map((m) => [m.email, m.role]));
    assert.equal(roles["editor@example.com"], "editor");
    assert.equal(roles["client@example.com"], "client");
  });

  test("clients can't change models or saved views; editors can", async () => {
    assert.equal((await t.uploadModel(client.cookie, project.id)).statusCode, 403);
    assert.equal(await status(client.cookie, { method: "DELETE", url: `/api/models/${model.id}` }), 403);
    assert.equal(await status(client.cookie, { method: "PUT", url: `/api/models/${model.id}/elements`, payload: { elements: [] } }), 403);
    // Reading is fine.
    assert.equal(await status(client.cookie, `/api/models/${model.id}/file`), 200);
    assert.equal(await status(client.cookie, `/api/models/${model.id}/elements.csv`), 200);

    assert.equal(await status(client.cookie, { method: "POST", url: "/api/views", payload: { projectId: project.id, name: "V", state: VIEW_STATE } }), 403);
    const view = (await t.as(editor.cookie, { method: "POST", url: "/api/views", payload: { projectId: project.id, name: "V", state: VIEW_STATE } })).json() as ViewRecord;
    assert.equal(await status(client.cookie, `/api/views?projectId=${project.id}`), 200);
    assert.equal(await status(client.cookie, { method: "PUT", url: `/api/views/${view.id}`, payload: { name: "W", state: VIEW_STATE } }), 403);
    assert.equal(await status(client.cookie, { method: "DELETE", url: `/api/views/${view.id}` }), 403);
    assert.equal(await status(editor.cookie, { method: "DELETE", url: `/api/views/${view.id}` }), 204);
  });

  test("clients raise issues but can't triage them", async () => {
    const raised = await t.as(client.cookie, { method: "POST", url: "/api/issues", payload: { projectId: project.id, title: "Leak in the ceiling", description: "Level 2" } });
    assert.equal(raised.statusCode, 201);
    const issue = raised.json() as IssueDetail;
    assert.equal(issue.status, "open");
    assert.equal(issue.authorId, client.user.id);
    // Triage fields are for editors and admins, when raising or editing.
    for (const payload of [{ status: "resolved" }, { priority: "high" }, { assigneeId: editor.user.id }, { dueDate: "2026-12-31" }]) {
      assert.equal(await status(client.cookie, { method: "POST", url: "/api/issues", payload: { projectId: project.id, title: "x", ...payload } }), 403);
      assert.equal(await status(client.cookie, { method: "PATCH", url: `/api/issues/${issue.id}`, payload }), 403);
    }
    // Content of their own issue is theirs to edit.
    const edited = await t.as(client.cookie, { method: "PATCH", url: `/api/issues/${issue.id}`, payload: { title: "Leak above room 204", labels: ["water"] } });
    assert.equal(edited.statusCode, 200);
    assert.equal((edited.json() as IssueDetail).title, "Leak above room 204");
    // Editors triage it.
    const triaged = await t.as(editor.cookie, { method: "PATCH", url: `/api/issues/${issue.id}`, payload: { status: "in_progress", assigneeId: editor.user.id, priority: "high" } });
    assert.equal(triaged.statusCode, 200);
    // Clients can't delete issues, even their own.
    assert.equal(await status(client.cookie, { method: "DELETE", url: `/api/issues/${issue.id}` }), 403);
  });

  test("clients can't edit other people's issues", async () => {
    const theirs = (await t.as(editor.cookie, { method: "POST", url: "/api/issues", payload: { projectId: project.id, title: "Editor's issue" } })).json() as IssueDetail;
    assert.equal(await status(client.cookie, { method: "PATCH", url: `/api/issues/${theirs.id}`, payload: { title: "Hijacked" } }), 403);
    assert.equal(await status(client.cookie, `/api/issues/${theirs.id}`), 200);
    assert.equal(await status(editor.cookie, { method: "DELETE", url: `/api/issues/${theirs.id}` }), 204);
  });

  test("everyone comments; only editors and admins delete other people's comments", async () => {
    const issue = (await t.as(editor.cookie, { method: "POST", url: "/api/issues", payload: { projectId: project.id, title: "Discuss" } })).json() as IssueDetail;
    const byClient = (await t.as(client.cookie, { method: "POST", url: `/api/issues/${issue.id}/comments`, payload: { body: "Seen" } })).json() as IssueDetail;
    const byEditor = (await t.as(editor.cookie, { method: "POST", url: `/api/issues/${issue.id}/comments`, payload: { body: "Thanks" } })).json() as IssueDetail;
    const clientComment = byClient.comments[0];
    const editorComment = byEditor.comments.find((c) => c.authorId === editor.user.id)!;
    assert.equal(await status(client.cookie, { method: "DELETE", url: `/api/comments/${editorComment.id}` }), 403);
    assert.equal(await status(editor.cookie, { method: "DELETE", url: `/api/comments/${clientComment.id}` }), 204);
    assert.equal(await status(editor.cookie, { method: "DELETE", url: `/api/comments/${editorComment.id}` }), 204);
  });

  test("BCF: everyone exports, only editors and admins import", async () => {
    assert.equal(await status(client.cookie, `/api/projects/${project.id}/bcf`), 200);
    const zip = (await t.as(editor.cookie, `/api/projects/${project.id}/bcf`)).rawPayload;
    const importAs = (cookie: string) =>
      t.as(cookie, { method: "POST", url: `/api/projects/${project.id}/bcf`, headers: { "content-type": "application/octet-stream" }, payload: zip });
    assert.equal((await importAs(client.cookie)).statusCode, 403);
    assert.equal((await importAs(editor.cookie)).statusCode, 200);
  });

  test("clients only see people they share a project with", async () => {
    const lonely = await t.createMember(admin.cookie, "lonely-client@example.com", "client");
    const visible = ((await t.as(client.cookie, "/api/users")).json() as User[]).map((u) => u.email).sort();
    assert.deepEqual(visible, ["admin@example.com", "client@example.com", "editor@example.com"]);
    assert.ok(!visible.includes(lonely.user.email) && !visible.includes(outsider.user.email));
    assert.ok(((await t.as(admin.cookie, "/api/users")).json() as User[]).length >= 5);
  });

  test("role changes take effect on the next request", async () => {
    await t.as(admin.cookie, { method: "PATCH", url: `/api/users/${client.user.id}`, payload: { role: "editor" } });
    assert.equal((await t.uploadModel(client.cookie, project.id, "promoted.ifc")).statusCode, 201);
    await t.as(admin.cookie, { method: "PATCH", url: `/api/users/${client.user.id}`, payload: { role: "client" } });
    assert.equal((await t.uploadModel(client.cookie, project.id, "demoted.ifc")).statusCode, 403);
  });

  test("members can leave a project", async () => {
    const leaver = await t.createMember(admin.cookie, "leaver@example.com", "client");
    await t.addMember(admin.cookie, project.id, leaver.user.id);
    assert.equal(await status(leaver.cookie, { method: "DELETE", url: `/api/projects/${project.id}/members/${leaver.user.id}` }), 200);
    assert.equal(await status(leaver.cookie, `/api/models?projectId=${project.id}`), 404);
  });
});
