import Database from "better-sqlite3";

/** Project that pre-existing data is moved into by migration 2. */
export const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run, so existing databases are upgraded in place. Only ever append.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE models (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    size          INTEGER NOT NULL,
    element_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE elements (
    model_id   TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    local_id   INTEGER NOT NULL,
    guid       TEXT,
    category   TEXT NOT NULL,
    name       TEXT,
    storey     TEXT,
    properties TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (model_id, local_id)
  );
  CREATE INDEX elements_guid ON elements(guid);
  CREATE INDEX elements_category ON elements(model_id, category);

  CREATE TABLE views (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    state      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE notes (
    id           TEXT PRIMARY KEY,
    model_id     TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    element_guid TEXT NOT NULL,
    element_name TEXT,
    category     TEXT,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX notes_element ON notes(model_id, element_guid);
  `,

  // 2: users, sessions and projects; everything else is scoped to a project.
  //    Notes become issues (several elements, viewpoint, snapshot, comments, BCF).
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT INTO projects (id, name) VALUES ('${DEFAULT_PROJECT_ID}', 'Default project');

  CREATE TABLE project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX project_members_user ON project_members(user_id);

  CREATE TABLE models_new (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    size          INTEGER NOT NULL,
    element_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT INTO models_new (id, project_id, name, file_name, size, element_count, created_at)
    SELECT id, '${DEFAULT_PROJECT_ID}', name, file_name, size, element_count, created_at FROM models;
  DROP TABLE models;
  ALTER TABLE models_new RENAME TO models;
  CREATE INDEX models_project ON models(project_id);

  CREATE TABLE views_new (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    state      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  INSERT INTO views_new (id, project_id, name, state, created_at, updated_at)
    SELECT id, '${DEFAULT_PROJECT_ID}', name, state, created_at, updated_at FROM views;
  DROP TABLE views;
  ALTER TABLE views_new RENAME TO views;
  CREATE INDEX views_project ON views(project_id);

  CREATE TABLE issues (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number      INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    type        TEXT NOT NULL DEFAULT 'issue',
    priority    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    due_date    TEXT,
    labels      TEXT NOT NULL DEFAULT '[]',
    viewpoint   TEXT,
    snapshot    BLOB,
    bcf_guid    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (project_id, number)
  );
  CREATE INDEX issues_project ON issues(project_id, status);
  CREATE UNIQUE INDEX issues_bcf ON issues(project_id, bcf_guid);

  CREATE TABLE issue_components (
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
    guid     TEXT NOT NULL,
    name     TEXT,
    category TEXT,
    PRIMARY KEY (issue_id, guid)
  );
  CREATE INDEX issue_components_guid ON issue_components(guid);
  CREATE INDEX issue_components_model ON issue_components(model_id);

  CREATE TABLE issue_comments (
    id         TEXT PRIMARY KEY,
    issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX issue_comments_issue ON issue_comments(issue_id);

  -- Existing notes become issues (their id doubles as the BCF topic GUID).
  INSERT INTO issues (id, project_id, number, title, description, status, bcf_guid, created_at, updated_at)
    SELECT id, '${DEFAULT_PROJECT_ID}', ROW_NUMBER() OVER (ORDER BY created_at, id), title, body, status, id, created_at, updated_at FROM notes;
  INSERT INTO issue_components (issue_id, model_id, guid, name, category)
    SELECT id, model_id, element_guid, element_name, category FROM notes;
  DROP TABLE notes;
  `,
];

export type Db = Database.Database;

export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= MIGRATIONS.length) return;
  // Table rebuilds (create new, copy, drop old, rename) need foreign keys off,
  // otherwise dropping a parent table cascades into its children. This is
  // SQLite's documented procedure; integrity is verified before switching back on.
  db.pragma("foreign_keys = OFF");
  try {
    for (let version = current; version < MIGRATIONS.length; version++) {
      db.transaction(() => {
        db.exec(MIGRATIONS[version]);
        const problems = db.pragma("foreign_key_check") as unknown[];
        if (problems.length) throw new Error(`Migration ${version + 1} broke ${problems.length} foreign key(s)`);
        db.pragma(`user_version = ${version + 1}`);
      })();
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
