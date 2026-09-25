import type { Db } from "../db.ts";

/** Shared by all route modules. */
export interface RouteContext {
  db: Db;
  /** Directory holding uploaded .frag files (`models/<id>.frag`). */
  dataDir: string;
  bodyLimit: number;
}

export const ID = { type: "string", pattern: "^[0-9a-f-]{36}$" } as const;
export const idParams = { type: "object", required: ["id"], properties: { id: ID } } as const;
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
