import { create } from "zustand";
import { HIDDEN_BY_DEFAULT } from "./ifc-classes";
import type { Project, User } from "../../shared/api";
import type { ClashRun } from "./clash-run";
import type { ColorByState } from "./colorby";
import type { CompareRun } from "./compare-run";
import type { Measurement, MeasureTool, Point } from "./measure";

export type SectionAxis = "x" | "y" | "z";

export interface ModelInfo {
  id: string;
  name: string;
  visible: boolean;
  /** Id in the server-side model library, once saved or when opened from it. */
  libraryId?: string;
}

export type FitTarget =
  | "all"
  | "selection"
  | { modelId: string; localIds: number[] }
  | { box: [[number, number, number], [number, number, number]] };

export interface Selection {
  modelId: string;
  localId: number;
}

interface ViewerState {
  /** Signed-in user (null until signed in). */
  user: User | null;
  projects: Project[];
  projectId: string | null;
  models: ModelInfo[];
  selection: Selection | null;
  loading: { label: string; progress: number } | null;
  error: string | null;
  section: { enabled: boolean; axis: SectionAxis; offset: number; flipped: boolean };
  ghost: boolean;
  /** IFC classes (e.g. "IFCSPACE") currently hidden via the Classes panel. */
  hiddenClasses: Set<string>;
  /** Bumped on every item visibility change so panels can re-read it. */
  visibilityVersion: number;
  /** Active tool: selection, or a measurement mode. */
  tool: "select" | MeasureTool;
  measurements: Measurement[];
  /** Points of the measurement being drawn. */
  draft: Point[];
  /** Active version comparison, if any. */
  compareRun: CompareRun | null;
  /** Last clash detection run and its results. */
  clashRun: ClashRun | null;
  /** Active colour-by-property (with its legend), if any. */
  colorBy: ColorByState | null;
  /** Issue shown in the Issues tab (opens that tab). */
  activeIssueId: string | null;
  /** New-issue dialog open (with the selection as component when true). */
  newIssueOpen: boolean;
  /** Bumped when library data (models, views, notes) changes on the server. */
  libraryVersion: number;
  /** Increment to ask the scene to frame everything, the selection, or specific items. */
  fitRequest: { n: number; target: FitTarget };

  setUser: (user: User | null) => void;
  setProjects: (projects: Project[]) => void;
  setProjectId: (projectId: string | null) => void;
  addModel: (m: ModelInfo) => void;
  removeModel: (id: string) => void;
  setModelVisible: (id: string, visible: boolean) => void;
  setLibraryId: (id: string, libraryId: string) => void;
  setActiveIssueId: (id: string | null) => void;
  setNewIssueOpen: (open: boolean) => void;
  setTool: (tool: ViewerState["tool"]) => void;
  setDraft: (draft: Point[]) => void;
  addMeasurement: (m: Omit<Measurement, "id">) => void;
  removeMeasurement: (id: number) => void;
  clearMeasurements: () => void;
  bumpLibrary: () => void;
  select: (s: Selection | null) => void;
  setLoading: (l: ViewerState["loading"]) => void;
  setError: (e: string | null) => void;
  setSection: (s: Partial<ViewerState["section"]>) => void;
  setGhost: (g: boolean) => void;
  setHiddenClasses: (h: Set<string>) => void;
  bumpVisibility: () => void;
  requestFit: (target?: FitTarget) => void;
}

let nextMeasurementId = 1;

export const useViewer = create<ViewerState>((set) => ({
  user: null,
  projects: [],
  projectId: null,
  models: [],
  selection: null,
  loading: null,
  error: null,
  section: { enabled: false, axis: "y", offset: 0.5, flipped: false },
  ghost: false,
  hiddenClasses: new Set(HIDDEN_BY_DEFAULT),
  visibilityVersion: 0,
  libraryVersion: 0,
  colorBy: null,
  clashRun: null,
  compareRun: null,
  activeIssueId: null,
  newIssueOpen: false,
  tool: "select",
  measurements: [],
  draft: [],
  fitRequest: { n: 0, target: "all" },

  setUser: (user) => set({ user }),
  setProjects: (projects) => set({ projects }),
  setProjectId: (projectId) => set((s) => ({ projectId, activeIssueId: null, libraryVersion: s.libraryVersion + 1 })),
  addModel: (m) => set((s) => ({ models: [...s.models, m] })),
  removeModel: (id) =>
    set((s) => ({
      models: s.models.filter((m) => m.id !== id),
      selection: s.selection?.modelId === id ? null : s.selection,
    })),
  setModelVisible: (id, visible) =>
    set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, visible } : m)) })),
  setLibraryId: (id, libraryId) =>
    set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, libraryId } : m)), libraryVersion: s.libraryVersion + 1 })),
  bumpLibrary: () => set((s) => ({ libraryVersion: s.libraryVersion + 1 })),
  setActiveIssueId: (activeIssueId) => set({ activeIssueId }),
  setNewIssueOpen: (newIssueOpen) => set({ newIssueOpen }),
  setTool: (tool) => set({ tool, draft: [] }),
  setDraft: (draft) => set({ draft }),
  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, { ...m, id: nextMeasurementId++ }], draft: [] })),
  removeMeasurement: (id) => set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) })),
  clearMeasurements: () => set({ measurements: [], draft: [] }),
  select: (selection) => set({ selection }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSection: (section) => set((s) => ({ section: { ...s.section, ...section } })),
  setGhost: (ghost) => set({ ghost }),
  setHiddenClasses: (hiddenClasses) => set((s) => ({ hiddenClasses, visibilityVersion: s.visibilityVersion + 1 })),
  bumpVisibility: () => set((s) => ({ visibilityVersion: s.visibilityVersion + 1 })),
  requestFit: (target = "all") => set((s) => ({ fitRequest: { n: s.fitRequest.n + 1, target } })),
}));

// Handy for debugging from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { __bimStore: typeof useViewer }).__bimStore = useViewer;
