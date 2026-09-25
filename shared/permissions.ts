/**
 * Role-based access control, shared by the API (enforcement) and the web app (what to show).
 *
 * Every account has one role. Project membership decides which projects a user
 * sees; the role decides what they may do in them. Admins see every project.
 *
 * - admin:  everything, including users, projects and project members
 * - editor: works on the models, saved views and issues of their projects
 * - client: reviews: views models and issues, raises issues and comments.
 *           Can edit the content of issues they raised, but not triage them
 *           (status, priority, assignee, due date) or delete them.
 */

export const ROLES = ["admin", "editor", "client"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", editor: "Editor", client: "Client" };

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Manages users, projects and members, and everything editors can do, in every project.",
  editor: "Uploads and deletes models, saves views, and creates, triages and deletes issues in their projects.",
  client: "Views models, views and issues in their projects, raises issues and comments. Can't change models or triage issues.",
};

const MATRIX = {
  /** Create, edit and delete user accounts and their roles. */
  "users.manage": ["admin"],
  /** Create, rename and delete projects; add and remove members. */
  "projects.manage": ["admin"],
  /** See every project, member or not. */
  "projects.seeAll": ["admin"],
  /** Upload and delete library models, and store their element data. */
  "models.write": ["admin", "editor"],
  /** Save, update and delete saved views. */
  "views.write": ["admin", "editor"],
  /** Raise new issues (clients: content only, see ISSUE_TRIAGE_FIELDS). */
  "issues.create": ["admin", "editor", "client"],
  /** Edit any issue's fields, including triage, and delete issues. */
  "issues.manage": ["admin", "editor"],
  /** Edit the content of issues the user raised. */
  "issues.editOwn": ["admin", "editor", "client"],
  /** Comment on issues. */
  "comments.create": ["admin", "editor", "client"],
  /** Delete anyone's comment (everyone may delete their own). */
  "comments.moderate": ["admin", "editor"],
  /** Import issues from BCF files. */
  "bcf.import": ["admin", "editor"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && (MATRIX[permission] as readonly Role[]).includes(role);
}

/** Issue fields only `issues.manage` may set: deciding what happens to an issue. */
export const ISSUE_TRIAGE_FIELDS = ["status", "priority", "assigneeId", "dueDate"] as const;

/** Roles that hold a permission, e.g. for help text. */
export const rolesWith = (permission: Permission): readonly Role[] => MATRIX[permission];
