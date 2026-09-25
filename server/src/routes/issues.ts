import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type BcfImportResult,
  type Issue,
  type IssueComment,
  type IssueComponent,
  type IssueDetail,
  type IssuePatch,
  type IssueViewpoint,
  type NewIssue,
} from "../../../shared/api.ts";
import { can, ISSUE_TRIAGE_FIELDS, type Permission } from "../../../shared/permissions.ts";
import { HttpError, requireProject } from "../auth.ts";
import { BcfError, readBcf, writeBcf, type BcfTopic } from "../bcf.ts";
import { ID, idParams, NOW, type RouteContext } from "./context.ts";
import { viewStateSchema } from "./views.ts";

interface IssueRow {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  status: Issue["status"];
  type: string;
  priority: Issue["priority"];
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  due_date: string | null;
  labels: string;
  viewpoint: string | null;
  has_snapshot: number;
  comment_count: number;
  bcf_guid: string;
  created_at: string;
  updated_at: string;
}

const SELECT_ISSUE = `
  SELECT i.id, i.project_id, i.number, i.title, i.description, i.status, i.type, i.priority,
         i.assignee_id, a.name AS assignee_name, a.email AS assignee_email,
         i.author_id, au.name AS author_name, au.email AS author_email,
         i.due_date, i.labels, i.viewpoint, i.snapshot IS NOT NULL AS has_snapshot, i.bcf_guid, i.created_at, i.updated_at,
         (SELECT COUNT(*) FROM issue_comments c WHERE c.issue_id = i.id) AS comment_count
  FROM issues i
  LEFT JOIN users a ON a.id = i.assignee_id
  LEFT JOIN users au ON au.id = i.author_id`;

// ---- Validation schemas --------------------------------------------------------------------------

const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } as const;
const viewpointSchema = {
  type: ["object", "null"],
  properties: {
    viewer: viewStateSchema,
    bcf: {
      type: "object",
      required: ["camera", "clippingPlanes"],
      properties: {
        camera: {
          type: "object",
          required: ["viewPoint", "direction", "upVector", "fieldOfView"],
          properties: { viewPoint: vec3, direction: vec3, upVector: vec3, fieldOfView: { type: "number", exclusiveMinimum: 0, maximum: 180 } },
        },
        clippingPlanes: {
          type: "array",
          maxItems: 6,
          items: { type: "object", required: ["location", "direction"], properties: { location: vec3, direction: vec3 } },
        },
      },
    },
  },
} as const;
const componentsSchema = {
  type: "array",
  maxItems: 1000,
  items: {
    type: "object",
    required: ["guid"],
    properties: {
      modelId: { anyOf: [ID, { type: "null" }] },
      guid: { type: "string", minLength: 1, maxLength: 64 },
      name: { type: ["string", "null"], maxLength: 500 },
      category: { type: ["string", "null"], maxLength: 100 },
    },
  },
} as const;
const issueFields = {
  title: { type: "string", minLength: 1, maxLength: 255 },
  description: { type: "string", maxLength: 20000 },
  status: { type: "string", enum: [...ISSUE_STATUSES] },
  type: { type: "string", minLength: 1, maxLength: 40 },
  priority: { type: "string", enum: [...ISSUE_PRIORITIES] },
  assigneeId: { anyOf: [ID, { type: "null" }] },
  dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
  labels: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
  components: componentsSchema,
  viewpoint: viewpointSchema,
  // Base64 PNG, max ~8 MB.
  snapshot: { anyOf: [{ type: "string", maxLength: 11_000_000, pattern: "^[A-Za-z0-9+/=]*$" }, { type: "null" }] },
} as const;

/** A UUID-shaped id derived from a string (for idempotent imports). */
function stableId(key: string) {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodeSnapshot(base64: string | null | undefined) {
  if (!base64) return null;
  const png = Buffer.from(base64, "base64");
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, "The snapshot must be a PNG image");
  return png;
}

export function issueRoutes({ db, bodyLimit }: RouteContext) {
  const components = (issueId: string): IssueComponent[] =>
    db
      .prepare("SELECT model_id AS modelId, guid, name, category FROM issue_components WHERE issue_id = ? ORDER BY rowid")
      .all(issueId) as IssueComponent[];

  const toIssue = (r: IssueRow): Issue => ({
    id: r.id,
    projectId: r.project_id,
    number: r.number,
    title: r.title,
    description: r.description,
    status: r.status,
    type: r.type,
    priority: r.priority,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    authorId: r.author_id,
    authorName: r.author_name,
    dueDate: r.due_date,
    labels: JSON.parse(r.labels),
    components: components(r.id),
    viewpoint: r.viewpoint ? (JSON.parse(r.viewpoint) as IssueViewpoint) : null,
    hasSnapshot: !!r.has_snapshot,
    commentCount: r.comment_count,
    bcfGuid: r.bcf_guid,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  const comments = (issueId: string): IssueComment[] =>
    db
      .prepare(
        `SELECT c.id, c.author_id AS authorId, u.name AS authorName, c.body, c.created_at AS createdAt
         FROM issue_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.issue_id = ? ORDER BY c.created_at, c.rowid`,
      )
      .all(issueId) as IssueComment[];

  const getRow = (id: string) => db.prepare<[string], IssueRow>(`${SELECT_ISSUE} WHERE i.id = ?`).get(id);
  const detail = (id: string): IssueDetail => {
    const row = getRow(id)!;
    return { ...toIssue(row), comments: comments(id) };
  };

  function accessIssue(req: FastifyRequest, id: string, permission?: Permission) {
    const row = getRow(id);
    if (!row) throw new HttpError(404, "Issue not found");
    try {
      return { row, ...requireProject(db, req, row.project_id, permission) };
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 404) throw new HttpError(404, "Issue not found");
      throw e;
    }
  }

  /** Roles without `issues.manage` (clients) can't triage: set status, priority, assignee or due date. */
  function checkTriage(role: Parameters<typeof can>[0], input: object) {
    if (can(role, "issues.manage")) return;
    const triage = ISSUE_TRIAGE_FIELDS.filter((f) => f in input && (input as Record<string, unknown>)[f] !== undefined);
    if (triage.length) throw new HttpError(403, `Only editors and admins can set ${triage.join(", ")}`);
  }

  /** Assignees and component models must belong to the issue's project. */
  function checkReferences(projectId: string, input: { assigneeId?: string | null; components?: IssueComponent[] }) {
    if (input.assigneeId) {
      const member =
        db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, input.assigneeId) ??
        db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'admin'").get(input.assigneeId);
      if (!member) throw new HttpError(400, "The assignee is not a member of this project");
    }
    for (const c of input.components ?? []) {
      if (c.modelId && !db.prepare("SELECT 1 FROM models WHERE id = ? AND project_id = ?").get(c.modelId, projectId)) {
        throw new HttpError(400, "A component refers to a model outside this project");
      }
    }
  }

  const insertComponent = db.prepare("INSERT OR IGNORE INTO issue_components (issue_id, model_id, guid, name, category) VALUES (?, ?, ?, ?, ?)");
  const replaceComponents = (issueId: string, list: IssueComponent[]) => {
    db.prepare("DELETE FROM issue_components WHERE issue_id = ?").run(issueId);
    for (const c of list) insertComponent.run(issueId, c.modelId ?? null, c.guid, c.name ?? null, c.category ?? null);
  };
  const nextNumber = (projectId: string) =>
    ((db.prepare("SELECT MAX(number) AS n FROM issues WHERE project_id = ?").get(projectId) as { n: number | null }).n ?? 0) + 1;

  return async (app: FastifyInstance) => {
    app.get<{ Querystring: { projectId: string; status?: string; guid?: string; modelId?: string; assigneeId?: string } }>(
      "/api/issues",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["projectId"],
            properties: {
              projectId: ID,
              status: { type: "string", enum: [...ISSUE_STATUSES] },
              guid: { type: "string", maxLength: 64 },
              modelId: ID,
              assigneeId: ID,
            },
          },
        },
      },
      async (req): Promise<Issue[]> => {
        requireProject(db, req, req.query.projectId);
        const where = ["i.project_id = @projectId"];
        const q = req.query;
        if (q.status) where.push("i.status = @status");
        if (q.assigneeId) where.push("i.assignee_id = @assigneeId");
        if (q.guid) where.push("EXISTS (SELECT 1 FROM issue_components c WHERE c.issue_id = i.id AND c.guid = @guid)");
        if (q.modelId) where.push("EXISTS (SELECT 1 FROM issue_components c WHERE c.issue_id = i.id AND c.model_id = @modelId)");
        return (db.prepare(`${SELECT_ISSUE} WHERE ${where.join(" AND ")} ORDER BY i.number DESC`).all(q) as IssueRow[]).map(toIssue);
      },
    );

    app.get<{ Params: { id: string } }>("/api/issues/:id", { schema: { params: idParams } }, async (req) => {
      accessIssue(req, req.params.id);
      return detail(req.params.id);
    });

    app.post<{ Body: NewIssue }>(
      "/api/issues",
      { bodyLimit: 16 * 1024 * 1024, schema: { body: { type: "object", required: ["projectId", "title"], properties: { projectId: ID, ...issueFields } } } },
      async (req, reply) => {
        const { user } = requireProject(db, req, req.body.projectId, "issues.create");
        const b = req.body;
        checkTriage(user.role, b);
        checkReferences(b.projectId, b);
        const snapshot = decodeSnapshot(b.snapshot);
        const id = randomUUID();
        db.transaction(() => {
          db.prepare(
            `INSERT INTO issues (id, project_id, number, title, description, status, type, priority, assignee_id, author_id, due_date, labels, viewpoint, snapshot, bcf_guid)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            b.projectId,
            nextNumber(b.projectId),
            b.title.trim(),
            b.description ?? "",
            b.status ?? "open",
            (b.type ?? "issue").toLowerCase(),
            b.priority ?? "normal",
            b.assigneeId ?? null,
            user.id,
            b.dueDate ?? null,
            JSON.stringify(b.labels ?? []),
            b.viewpoint ? JSON.stringify(b.viewpoint) : null,
            snapshot,
            id,
          );
          replaceComponents(id, b.components ?? []);
        })();
        return reply.code(201).send(detail(id));
      },
    );

    app.patch<{ Params: { id: string }; Body: IssuePatch }>(
      "/api/issues/:id",
      { bodyLimit: 16 * 1024 * 1024, schema: { params: idParams, body: { type: "object", minProperties: 1, properties: issueFields } } },
      async (req) => {
        const { row, user } = accessIssue(req, req.params.id);
        const b = req.body;
        // Editors and admins edit any issue; clients only the content of issues they raised.
        const ownIssue = row.author_id === user.id && can(user.role, "issues.editOwn");
        if (!can(user.role, "issues.manage") && !ownIssue) throw new HttpError(403, "You can only edit issues you raised");
        checkTriage(user.role, b);
        checkReferences(row.project_id, b);
        const sets: string[] = [];
        const values: unknown[] = [];
        const set = (column: string, value: unknown) => {
          sets.push(`${column} = ?`);
          values.push(value);
        };
        if (b.title !== undefined) set("title", b.title.trim());
        if (b.description !== undefined) set("description", b.description);
        if (b.status !== undefined) set("status", b.status);
        if (b.type !== undefined) set("type", b.type.toLowerCase());
        if (b.priority !== undefined) set("priority", b.priority);
        if (b.assigneeId !== undefined) set("assignee_id", b.assigneeId);
        if (b.dueDate !== undefined) set("due_date", b.dueDate);
        if (b.labels !== undefined) set("labels", JSON.stringify(b.labels));
        if (b.viewpoint !== undefined) set("viewpoint", b.viewpoint ? JSON.stringify(b.viewpoint) : null);
        if (b.snapshot !== undefined) set("snapshot", decodeSnapshot(b.snapshot));
        db.transaction(() => {
          if (sets.length) db.prepare(`UPDATE issues SET ${sets.join(", ")}, updated_at = ${NOW} WHERE id = ?`).run(...values, req.params.id);
          if (b.components) {
            replaceComponents(req.params.id, b.components);
            if (!sets.length) db.prepare(`UPDATE issues SET updated_at = ${NOW} WHERE id = ?`).run(req.params.id);
          }
        })();
        return detail(req.params.id);
      },
    );

    app.delete<{ Params: { id: string } }>("/api/issues/:id", { schema: { params: idParams } }, async (req, reply) => {
      accessIssue(req, req.params.id, "issues.manage");
      db.prepare("DELETE FROM issues WHERE id = ?").run(req.params.id);
      return reply.code(204).send();
    });

    app.get<{ Params: { id: string } }>("/api/issues/:id/snapshot.png", { schema: { params: idParams } }, async (req, reply) => {
      accessIssue(req, req.params.id);
      const row = db.prepare("SELECT snapshot FROM issues WHERE id = ?").get(req.params.id) as { snapshot: Buffer | null };
      if (!row.snapshot) throw new HttpError(404, "This issue has no snapshot");
      return reply.type("image/png").header("cache-control", "private, max-age=60").send(row.snapshot);
    });

    // ---- Comments ----------------------------------------------------------------------------

    // Clients comment too: reviewing and replying is their main job.
    app.post<{ Params: { id: string }; Body: { body: string } }>(
      "/api/issues/:id/comments",
      { schema: { params: idParams, body: { type: "object", required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 20000 } } } } },
      async (req, reply) => {
        const { user } = accessIssue(req, req.params.id, "comments.create");
        db.transaction(() => {
          db.prepare("INSERT INTO issue_comments (id, issue_id, author_id, body) VALUES (?, ?, ?, ?)").run(randomUUID(), req.params.id, user.id, req.body.body.trim());
          db.prepare(`UPDATE issues SET updated_at = ${NOW} WHERE id = ?`).run(req.params.id);
        })();
        return reply.code(201).send(detail(req.params.id));
      },
    );

    app.delete<{ Params: { id: string } }>("/api/comments/:id", { schema: { params: idParams } }, async (req, reply) => {
      const comment = db.prepare("SELECT issue_id, author_id FROM issue_comments WHERE id = ?").get(req.params.id) as
        | { issue_id: string; author_id: string | null }
        | undefined;
      if (!comment) throw new HttpError(404, "Comment not found");
      const { user } = accessIssue(req, comment.issue_id);
      // Authors delete their own comments; editors and admins any.
      if (comment.author_id !== user.id && !can(user.role, "comments.moderate")) throw new HttpError(403, "You can only delete your own comments");
      db.prepare("DELETE FROM issue_comments WHERE id = ?").run(req.params.id);
      return reply.code(204).send();
    });

    // ---- BCF export / import -----------------------------------------------------------------

    app.get<{ Params: { id: string }; Querystring: { ids?: string } }>(
      "/api/projects/:id/bcf",
      { schema: { params: idParams, querystring: { type: "object", properties: { ids: { type: "string", maxLength: 40000 } } } } },
      async (req, reply) => {
        requireProject(db, req, req.params.id);
        const wanted = req.query.ids ? new Set(req.query.ids.split(",")) : null;
        const rows = (db.prepare(`${SELECT_ISSUE} WHERE i.project_id = ? ORDER BY i.number`).all(req.params.id) as IssueRow[]).filter(
          (r) => !wanted || wanted.has(r.id),
        );
        const topics: BcfTopic[] = rows.map((r) => {
          const issue = toIssue(r);
          const snapshot = (db.prepare("SELECT snapshot FROM issues WHERE id = ?").get(r.id) as { snapshot: Buffer | null }).snapshot;
          const bcf = issue.viewpoint?.bcf;
          return {
            guid: r.bcf_guid,
            title: r.title,
            description: r.description,
            status: r.status,
            type: r.type,
            priority: r.priority,
            index: r.number,
            labels: issue.labels,
            creationDate: new Date(r.created_at).toISOString(),
            creationAuthor: r.author_email ?? "unknown",
            modifiedDate: new Date(r.updated_at).toISOString(),
            dueDate: r.due_date ? new Date(r.due_date).toISOString() : null,
            assignedTo: r.assignee_email,
            comments: comments(r.id).map((c) => ({
              guid: c.id,
              date: new Date(c.createdAt).toISOString(),
              author: (c.authorId && (db.prepare("SELECT email FROM users WHERE id = ?").pluck().get(c.authorId) as string)) || "unknown",
              text: c.body,
            })),
            viewpoint:
              bcf || issue.components.length
                ? { camera: bcf?.camera ?? null, clippingPlanes: bcf?.clippingPlanes ?? [], selection: issue.components.map((c) => c.guid) }
                : null,
            snapshot: snapshot ? new Uint8Array(snapshot) : null,
          };
        });
        const project = db.prepare("SELECT name FROM projects WHERE id = ?").pluck().get(req.params.id) as string;
        const file = `${project.replace(/[^\w.-]+/g, "_") || "issues"}.bcfzip`;
        return reply
          .type("application/octet-stream")
          .header("content-disposition", `attachment; filename="${file}"`)
          .send(Buffer.from(writeBcf(topics)));
      },
    );

    app.post<{ Params: { id: string }; Body: Buffer }>(
      "/api/projects/:id/bcf",
      { bodyLimit, schema: { params: idParams } },
      async (req): Promise<BcfImportResult> => {
        const { user } = requireProject(db, req, req.params.id, "bcf.import");
        if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, "Send the .bcfzip as application/octet-stream");
        let topics: BcfTopic[];
        try {
          topics = readBcf(new Uint8Array(req.body));
        } catch (e) {
          throw new HttpError(400, e instanceof BcfError ? e.message : "Could not read the BCF file");
        }
        const projectId = req.params.id;
        const userByEmail = (email: string | null) =>
          email ? (db.prepare("SELECT id FROM users WHERE email = ?").pluck().get(email.trim()) as string | undefined) ?? null : null;
        const isMember = (userId: string | null) =>
          !!userId && !!(db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, userId) ?? db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'admin'").get(userId));
        // Components are linked to library models of this project by GUID when possible.
        const elementByGuid = db.prepare(
          `SELECT e.model_id, e.name, e.category FROM elements e JOIN models m ON m.id = e.model_id WHERE m.project_id = ? AND e.guid = ? LIMIT 1`,
        );
        let created = 0;
        let updated = 0;
        db.transaction(() => {
          for (const t of topics) {
            const assignee = userByEmail(t.assignedTo);
            const author = userByEmail(t.creationAuthor) ?? user.id;
            const viewpoint: IssueViewpoint | null = t.viewpoint?.camera ? { bcf: { camera: t.viewpoint.camera, clippingPlanes: t.viewpoint.clippingPlanes } } : null;
            const due = t.dueDate && !Number.isNaN(Date.parse(t.dueDate)) ? new Date(t.dueDate).toISOString().slice(0, 10) : null;
            const existing = db.prepare("SELECT id FROM issues WHERE project_id = ? AND bcf_guid = ?").pluck().get(projectId, t.guid) as string | undefined;
            const id = existing ?? randomUUID();
            const values = [
              t.title.slice(0, 255),
              t.description.slice(0, 20000),
              t.status,
              t.type,
              t.priority,
              isMember(assignee) ? assignee : null,
              due,
              JSON.stringify(t.labels.slice(0, 20)),
              viewpoint ? JSON.stringify(viewpoint) : null,
              t.snapshot ? Buffer.from(t.snapshot) : null,
            ];
            if (existing) {
              db.prepare(
                `UPDATE issues SET title = ?, description = ?, status = ?, type = ?, priority = ?, assignee_id = ?, due_date = ?, labels = ?,
                 viewpoint = COALESCE(?, viewpoint), snapshot = COALESCE(?, snapshot), updated_at = ${NOW} WHERE id = ?`,
              ).run(...values, id);
              updated++;
            } else {
              db.prepare(
                `INSERT INTO issues (id, project_id, number, title, description, status, type, priority, assignee_id, due_date, labels, viewpoint, snapshot, author_id, bcf_guid, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).run(id, projectId, nextNumber(projectId), ...values, author, t.guid, Number.isNaN(Date.parse(t.creationDate)) ? new Date().toISOString() : new Date(t.creationDate).toISOString());
              created++;
            }
            if (t.viewpoint?.selection.length) {
              replaceComponents(
                id,
                t.viewpoint.selection.slice(0, 1000).map((guid) => {
                  const e = elementByGuid.get(projectId, guid) as { model_id: string; name: string | null; category: string } | undefined;
                  return { guid, modelId: e?.model_id ?? null, name: e?.name ?? null, category: e?.category ?? null };
                }),
              );
            }
            // Comments are keyed by their BCF GUID, so re-importing doesn't duplicate them.
            for (const c of t.comments) {
              // Keep the original id when it is already this issue's comment (round trip within the
              // project); otherwise derive a stable id from (issue, BCF GUID) so re-imports are idempotent.
              const original = /^[0-9a-f-]{36}$/i.test(c.guid) ? c.guid.toLowerCase() : null;
              const ownIssue = original ? (db.prepare("SELECT issue_id FROM issue_comments WHERE id = ?").pluck().get(original) as string | undefined) : undefined;
              const commentId = original && (ownIssue === id || ownIssue === undefined) ? original : stableId(`${id}:${c.guid}`);
              db.prepare("INSERT OR IGNORE INTO issue_comments (id, issue_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
                commentId,
                id,
                userByEmail(c.author),
                c.text.slice(0, 20000),
                Number.isNaN(Date.parse(c.date)) ? new Date().toISOString() : new Date(c.date).toISOString(),
              );
            }
          }
        })();
        return { created, updated };
      },
    );
  };
}
