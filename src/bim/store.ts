import { create } from "zustand";
import { HIDDEN_BY_DEFAULT } from "./ifc-classes";

export type SectionAxis = "x" | "y" | "z";

export interface ModelInfo {
  id: string;
  name: string;
  visible: boolean;
}

export type FitTarget = "all" | "selection" | { modelId: string; localIds: number[] };

export interface Selection {
  modelId: string;
  localId: number;
}

interface ViewerState {
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
  /** Increment to ask the scene to frame everything, the selection, or specific items. */
  fitRequest: { n: number; target: FitTarget };

  addModel: (m: ModelInfo) => void;
  removeModel: (id: string) => void;
  setModelVisible: (id: string, visible: boolean) => void;
  select: (s: Selection | null) => void;
  setLoading: (l: ViewerState["loading"]) => void;
  setError: (e: string | null) => void;
  setSection: (s: Partial<ViewerState["section"]>) => void;
  setGhost: (g: boolean) => void;
  setHiddenClasses: (h: Set<string>) => void;
  bumpVisibility: () => void;
  requestFit: (target?: FitTarget) => void;
}

export const useViewer = create<ViewerState>((set) => ({
  models: [],
  selection: null,
  loading: null,
  error: null,
  section: { enabled: false, axis: "y", offset: 0.5, flipped: false },
  ghost: false,
  hiddenClasses: new Set(HIDDEN_BY_DEFAULT),
  visibilityVersion: 0,
  fitRequest: { n: 0, target: "all" },

  addModel: (m) => set((s) => ({ models: [...s.models, m] })),
  removeModel: (id) =>
    set((s) => ({
      models: s.models.filter((m) => m.id !== id),
      selection: s.selection?.modelId === id ? null : s.selection,
    })),
  setModelVisible: (id, visible) =>
    set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, visible } : m)) })),
  select: (selection) => set({ selection }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSection: (section) => set((s) => ({ section: { ...s.section, ...section } })),
  setGhost: (ghost) => set({ ghost }),
  setHiddenClasses: (hiddenClasses) => set((s) => ({ hiddenClasses, visibilityVersion: s.visibilityVersion + 1 })),
  bumpVisibility: () => set((s) => ({ visibilityVersion: s.visibilityVersion + 1 })),
  requestFit: (target = "all") => set((s) => ({ fitRequest: { n: s.fitRequest.n + 1, target } })),
}));
