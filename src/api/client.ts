import type {
  CategoryCount,
  ElementRecord,
  ElementSearchResponse,
  ModelRecord,
  NewNote,
  NotePatch,
  NoteRecord,
  NoteStatus,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Cannot reach the API server. Is it running (npm run dev)?");
  }
  if (!res.ok) {
    const detail = await res.json().then((b) => b.error ?? b.message, () => res.statusText);
    throw new ApiError(res.status, `${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : (res.arrayBuffer() as Promise<T>);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
};

export const api = {
  health: () => request<{ ok: boolean }>("/health"),

  listModels: () => request<ModelRecord[]>("/models"),
  uploadModel: (name: string, bytes: ArrayBuffer) =>
    request<ModelRecord>(`/models${qs({ name, fileName: name.replace(/\.ifc$/i, ".frag") })}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    }),
  modelFile: (id: string) => request<ArrayBuffer>(`/models/${id}/file`),
  deleteModel: (id: string) => request<void>(`/models/${id}`, { method: "DELETE" }),
  saveElements: (id: string, elements: ElementRecord[]) => request<{ count: number }>(`/models/${id}/elements`, json("PUT", { elements })),
  elementsCsvUrl: (id: string) => `/api/models/${id}/elements.csv`,

  searchElements: (params: { q?: string; category?: string; modelId?: string; limit?: number; offset?: number }) =>
    request<ElementSearchResponse>(`/elements${qs(params)}`),
  categories: (modelId?: string) => request<CategoryCount[]>(`/elements/categories${qs({ modelId })}`),

  listViews: () => request<ViewRecord[]>("/views"),
  createView: (name: string, state: ViewState) => request<ViewRecord>("/views", json("POST", { name, state })),
  updateView: (id: string, name: string, state: ViewState) => request<ViewRecord>(`/views/${id}`, json("PUT", { name, state })),
  deleteView: (id: string) => request<void>(`/views/${id}`, { method: "DELETE" }),

  listNotes: (params: { modelId?: string; guid?: string; status?: NoteStatus } = {}) => request<NoteRecord[]>(`/notes${qs(params)}`),
  createNote: (note: NewNote) => request<NoteRecord>("/notes", json("POST", note)),
  updateNote: (id: string, patch: NotePatch) => request<NoteRecord>(`/notes/${id}`, json("PATCH", patch)),
  deleteNote: (id: string) => request<void>(`/notes/${id}`, { method: "DELETE" }),
};
