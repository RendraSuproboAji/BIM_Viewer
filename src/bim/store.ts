import { create } from "zustand";

export type SectionAxis = "x" | "y" | "z";

export interface ModelInfo {
  id: string;
  name: string;
  visible: boolean;
}

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
  /** Increment to ask the scene to frame everything (or the selection). */
  fitRequest: { n: number; target: "all" | "selection" };

  addModel: (m: ModelInfo) => void;
  removeModel: (id: string) => void;
  setModelVisible: (id: string, visible: boolean) => void;
  select: (s: Selection | null) => void;
  setLoading: (l: ViewerState["loading"]) => void;
  setError: (e: string | null) => void;
  setSection: (s: Partial<ViewerState["section"]>) => void;
  setGhost: (g: boolean) => void;
  requestFit: (target?: "all" | "selection") => void;
}

export const useViewer = create<ViewerState>((set) => ({
  models: [],
  selection: null,
  loading: null,
  error: null,
  section: { enabled: false, axis: "y", offset: 0.5, flipped: false },
  ghost: false,
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
  requestFit: (target = "all") => set((s) => ({ fitRequest: { n: s.fitRequest.n + 1, target } })),
}));
