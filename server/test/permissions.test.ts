import assert from "node:assert/strict";
import { test } from "node:test";
import { can, ROLES, type Permission } from "../../shared/permissions.ts";

test("admins hold every permission", () => {
  for (const permission of ["users.manage", "projects.manage", "models.write", "issues.manage", "bcf.import"] as Permission[]) {
    assert.ok(can("admin", permission), permission);
  }
});

test("editors work on content but don't administer", () => {
  assert.ok(can("editor", "models.write"));
  assert.ok(can("editor", "views.write"));
  assert.ok(can("editor", "issues.manage"));
  assert.ok(!can("editor", "users.manage"));
  assert.ok(!can("editor", "projects.manage"));
  assert.ok(!can("editor", "projects.seeAll"));
});

test("clients review: view, raise issues and comment only", () => {
  assert.ok(can("client", "issues.create"));
  assert.ok(can("client", "issues.editOwn"));
  assert.ok(can("client", "comments.create"));
  for (const permission of ["models.write", "views.write", "issues.manage", "comments.moderate", "bcf.import", "projects.manage"] as Permission[]) {
    assert.ok(!can("client", permission), permission);
  }
});

test("no role, no permission", () => {
  assert.ok(!can(null, "issues.create"));
  assert.ok(!can(undefined, "comments.create"));
  assert.deepEqual([...ROLES], ["admin", "editor", "client"]);
});
