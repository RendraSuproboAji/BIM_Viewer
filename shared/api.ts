/** Types shared by the web app (src/) and the API server (server/). */

export interface ModelRecord {
  id: string;
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
  name: string;
  state: ViewState;
  createdAt: string;
  updatedAt: string;
}

export const NOTE_STATUSES = ["open", "in_progress", "resolved"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export interface NoteRecord {
  id: string;
  modelId: string;
  elementGuid: string;
  elementName: string | null;
  category: string | null;
  title: string;
  body: string;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
}

export type NewNote = Pick<NoteRecord, "modelId" | "elementGuid" | "title"> &
  Partial<Pick<NoteRecord, "elementName" | "category" | "body" | "status">>;

export type NotePatch = Partial<Pick<NoteRecord, "title" | "body" | "status">>;
