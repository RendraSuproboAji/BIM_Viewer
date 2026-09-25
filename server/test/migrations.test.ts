import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { DEFAULT_PROJECT_ID, openDatabase } from "../src/db.ts";

test("upgrading a version-1 database keeps all data", () => {
  const dir = mkdtempSync(join(tmpdir(), "bim-migrate-"));
  const file = join(dir, "v1.sqlite");
  try {
    // Build a version-1 database from the first migration and fill it.
    const source = readFileSync(new URL("../src/db.ts", import.meta.url), "utf8");
    const firstMigration = source.split("const MIGRATIONS: string[] = [")[1].split("`")[1];
    const v1 = new Database(file);
    v1.exec(firstMigration);
    v1.pragma("user_version = 1");
    v1.prepare("INSERT INTO models (id, name, file_name, size, element_count) VALUES ('m1', 'house.ifc', 'house.frag', 10, 2)").run();
    v1.prepare("INSERT INTO elements (model_id, local_id, guid, category) VALUES ('m1', 1, 'g1', 'IFCWALL'), ('m1', 2, 'g2', 'IFCSLAB')").run();
    v1.prepare("INSERT INTO views (id, name, state) VALUES ('v1', 'View', '{}')").run();
    v1.prepare(
      `INSERT INTO notes (id, model_id, element_guid, element_name, category, title, body, status, created_at) VALUES
       ('n1', 'm1', 'g1', 'Wall', 'IFCWALL', 'Crack', 'North side', 'in_progress', '2026-01-01T00:00:00Z'),
       ('n2', 'm1', 'g2', NULL, NULL, 'Hole', '', 'open', '2026-01-02T00:00:00Z')`,
    ).run();
    v1.close();

    const db = openDatabase(file);
    assert.equal(db.pragma("user_version", { simple: true }), 2);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.deepEqual(db.prepare("SELECT id, project_id FROM models").all(), [{ id: "m1", project_id: DEFAULT_PROJECT_ID }]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM elements").get() as { n: number }).n, 2);
    assert.deepEqual(db.prepare("SELECT id, project_id FROM views").all(), [{ id: "v1", project_id: DEFAULT_PROJECT_ID }]);
    assert.deepEqual(db.prepare("SELECT number, title, description, status, bcf_guid FROM issues ORDER BY number").all(), [
      { number: 1, title: "Crack", description: "North side", status: "in_progress", bcf_guid: "n1" },
      { number: 2, title: "Hole", description: "", status: "open", bcf_guid: "n2" },
    ]);
    assert.deepEqual(db.prepare("SELECT issue_id, model_id, guid, name FROM issue_components ORDER BY issue_id").all(), [
      { issue_id: "n1", model_id: "m1", guid: "g1", name: "Wall" },
      { issue_id: "n2", model_id: "m1", guid: "g2", name: null },
    ]);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'notes'").get(), undefined);

    // Foreign keys still work on the rebuilt tables: elements cascade, issues keep their components.
    db.prepare("DELETE FROM models WHERE id = 'm1'").run();
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM elements").get() as { n: number }).n, 0);
    assert.deepEqual(db.prepare("SELECT model_id FROM issue_components").all(), [{ model_id: null }, { model_id: null }]);
    db.close();

    // Reopening is a no-op.
    const again = openDatabase(file);
    assert.equal(again.pragma("user_version", { simple: true }), 2);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
