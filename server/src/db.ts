import Database from "better-sqlite3";

/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many
 * have run, so existing databases are upgraded in place. Only ever append.
 */
const MIGRATIONS = [
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
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
