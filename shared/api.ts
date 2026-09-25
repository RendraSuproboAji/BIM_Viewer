/** Types shared by the web app (src/) and the API server (server/). */

export interface ModelRecord {
  id: string;
  projectId: string;
  name: string;
  fileName: string;
  size: number;
  elementCount: number;
  createdAt: string;
}

/** Property set name → property name → display value. */
export type ElementProperties = Record<string, Record<string, string>>;

export interface ElementRecord {
  localId: number;
  guid: string | null;
  category: string;
  name: string | null;
  storey: string | null;
  properties: ElementProperties;
}

export interface ElementSearchResult extends ElementRecord {
  modelId: string;
  modelName: string;
}

export interface ElementSearchResponse {
  total: number;
  items: ElementSearchResult[];
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface ViewState {
  camera: CameraState;
  section: { enabled: boolean; axis: "x" | "y" | "z"; offset: number; flipped: boolean };
  hiddenClasses: string[];
  ghost: boolean;
  /** Library ids of the models that were open. */
  models: string[];
}

export interface ViewRecord {
  id: string;
  projectId: string;
  name: string;
  state: ViewState;
  createdAt: string;
  updatedAt: string;
}

// ---- Users, sessions and projects -----------------------------------------------------------------

export type UserRole = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthStatus {
  /** True until the first (admin) account has been created. */
  setupRequired: boolean;
  user: User | null;
}

export const PROJECT_ROLES = ["owner", "editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  /** The current user's role in the project (admins act as owners). */
  role: ProjectRole;
}

export interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
}

// ---- Issues (BCF topics) -------------------------------------------------------------------------

export const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export const ISSUE_TYPES = ["issue", "clash", "request", "question", "comment"] as const;

export interface IssueComponent {
  /** Library model the element belongs to (null if that model was deleted or is unknown). */
  modelId: string | null;
  guid: string;
  name: string | null;
  category: string | null;
}

/** Camera in IFC coordinates (Z up, metres), as BCF stores it. */
export interface BcfCamera {
  viewPoint: [number, number, number];
  direction: [number, number, number];
  upVector: [number, number, number];
  fieldOfView: number;
}

export interface BcfClippingPlane {
  location: [number, number, number];
  direction: [number, number, number];
}

export interface IssueViewpoint {
  /** Exact viewer state, restored as-is by this viewer. */
  viewer?: ViewState;
  /** Interoperable BCF form, written to and read from .bcfzip files. */
  bcf?: { camera: BcfCamera; clippingPlanes: BcfClippingPlane[] };
}

export interface IssueComment {
  id: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface Issue {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  status: IssueStatus;
  type: string;
  priority: IssuePriority;
  assigneeId: string | null;
  assigneeName: string | null;
  authorId: string | null;
  authorName: string | null;
  dueDate: string | null;
  labels: string[];
  components: IssueComponent[];
  viewpoint: IssueViewpoint | null;
  hasSnapshot: boolean;
  commentCount: number;
  bcfGuid: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueDetail extends Issue {
  comments: IssueComment[];
}

export interface NewIssue {
  projectId: string;
  title: string;
  description?: string;
  status?: IssueStatus;
  type?: string;
  priority?: IssuePriority;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels?: string[];
  components?: IssueComponent[];
  viewpoint?: IssueViewpoint | null;
  /** PNG as base64 (no data: prefix). */
  snapshot?: string | null;
}

export type IssuePatch = Partial<Omit<NewIssue, "projectId" | "components">> & { components?: IssueComponent[] };

export interface BcfImportResult {
  created: number;
  updated: number;
}
