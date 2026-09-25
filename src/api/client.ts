import type {
  AuthStatus,
  BcfImportResult,
  CategoryCount,
  ElementRecord,
  ElementSearchResponse,
  Issue,
  IssueDetail,
  IssuePatch,
  IssueStatus,
  ModelRecord,
  NewIssue,
  Project,
  ProjectMember,
  User,
  UserRole,
  ViewRecord,
  ViewState,
} from "../../shared/api";

/** Thin typed client for the API in server/ (proxied to /api by Vite in development). */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Called when the server says the session is gone (401), so the app can show the sign-in screen. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * Incremented on every sign-in/out. A 401 only ends the session when its request
 * was started in the current session; stale requests from a previous user
 * (still in flight at logout) must not sign out the next one.
 */
let sessionEpoch = 0;
export function newSessionEpoch() {
  sessionEpoch++;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const epoch = sessionEpoch;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "Cannot reach the API server. Is it running (npm run dev)?");
  }
  if (!res.ok) {
    const detail = await res.json().then((b) => b.error ?? b.message, () => res.statusText);
    if (res.status === 401 && !path.startsWith("/auth/") && epoch === sessionEpoch) onUnauthorized?.();
    throw new ApiError(res.status, detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : (res.arrayBuffer() as Promise<T>);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const binary = (bytes: ArrayBuffer | Uint8Array): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/octet-stream" },
  body: bytes as BodyInit,
});

const qs = (params: Record<string, string | number | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
};

export const api = {
  health: () => request<{ ok: boolean }>("/health"),

  // ---- Auth & users ----
  status: () => request<AuthStatus>("/auth/status"),
  setup: (body: { email: string; name: string; password: string }) => request<User>("/auth/setup", json("POST", body)),
  login: (email: string, password: string) => request<User>("/auth/login", json("POST", { email, password })),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>("/auth/password", json("POST", { currentPassword, newPassword })),
  listUsers: () => request<User[]>("/users"),
  createUser: (body: { email: string; name: string; password: string; role: UserRole }) => request<User>("/users", json("POST", body)),
  updateUser: (id: string, patch: { name?: string; role?: UserRole; password?: string }) => request<User>(`/users/${id}`, json("PATCH", patch)),
  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),

  // ---- Projects ----
  listProjects: () => request<Project[]>("/projects"),
  createProject: (name: string) => request<Project>("/projects", json("POST", { name })),
  renameProject: (id: string, name: string) => request<Project>(`/projects/${id}`, json("PATCH", { name })),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  listMembers: (projectId: string) => request<ProjectMember[]>(`/projects/${projectId}/members`),
  addMember: (projectId: string, userId: string) => request<ProjectMember[]>(`/projects/${projectId}/members`, json("PUT", { userId })),
  removeMember: (projectId: string, userId: string) => request<ProjectMember[]>(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),

  // ---- Models & BIM data ----
  listModels: (projectId: string) => request<ModelRecord[]>(`/models${qs({ projectId })}`),
  uploadModel: (projectId: string, name: string, bytes: ArrayBuffer) =>
    request<ModelRecord>(`/models${qs({ projectId, name, fileName: name.replace(/\.ifc$/i, ".frag") })}`, binary(bytes)),
  modelFile: (id: string) => request<ArrayBuffer>(`/models/${id}/file`),
  deleteModel: (id: string) => request<void>(`/models/${id}`, { method: "DELETE" }),
  saveElements: (id: string, elements: ElementRecord[]) => request<{ count: number }>(`/models/${id}/elements`, json("PUT", { elements })),
  elementsCsvUrl: (id: string) => `/api/models/${id}/elements.csv`,
  searchElements: (params: { projectId: string; q?: string; category?: string; modelId?: string; limit?: number; offset?: number }) =>
    request<ElementSearchResponse>(`/elements${qs(params)}`),
  categories: (projectId: string, modelId?: string) => request<CategoryCount[]>(`/elements/categories${qs({ projectId, modelId })}`),

  // ---- Saved views ----
  listViews: (projectId: string) => request<ViewRecord[]>(`/views${qs({ projectId })}`),
  createView: (projectId: string, name: string, state: ViewState) => request<ViewRecord>("/views", json("POST", { projectId, name, state })),
  updateView: (id: string, name: string, state: ViewState) => request<ViewRecord>(`/views/${id}`, json("PUT", { name, state })),
  deleteView: (id: string) => request<void>(`/views/${id}`, { method: "DELETE" }),

  // ---- Issues ----
  listIssues: (params: { projectId: string; status?: IssueStatus; guid?: string; modelId?: string; assigneeId?: string }) =>
    request<Issue[]>(`/issues${qs(params)}`),
  getIssue: (id: string) => request<IssueDetail>(`/issues/${id}`),
  createIssue: (issue: NewIssue) => request<IssueDetail>("/issues", json("POST", issue)),
  updateIssue: (id: string, patch: IssuePatch) => request<IssueDetail>(`/issues/${id}`, json("PATCH", patch)),
  deleteIssue: (id: string) => request<void>(`/issues/${id}`, { method: "DELETE" }),
  snapshotUrl: (issue: Pick<Issue, "id" | "updatedAt">) => `/api/issues/${issue.id}/snapshot.png?v=${encodeURIComponent(issue.updatedAt)}`,
  addComment: (issueId: string, body: string) => request<IssueDetail>(`/issues/${issueId}/comments`, json("POST", { body })),
  deleteComment: (id: string) => request<void>(`/comments/${id}`, { method: "DELETE" }),
  bcfExportUrl: (projectId: string, ids?: string[]) => `/api/projects/${projectId}/bcf${qs({ ids: ids?.join(",") })}`,
  importBcf: (projectId: string, bytes: ArrayBuffer) => request<BcfImportResult>(`/projects/${projectId}/bcf`, binary(bytes)),
};
