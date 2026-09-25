import * as THREE from "three";
import { engine } from "./engine";
import { openModelElements } from "./model-data";
import { useViewer } from "./store";
import { colorLegend, fieldLabel, type FieldKey, type LegendEntry } from "./takeoff";

export interface ColorByState {
  key: FieldKey;
  label: string;
  numeric: boolean;
  legend: LegendEntry[];
  /** Legend labels currently hidden. */
  hidden: string[];
}

/** Colours every element of the open models by a field's value. */
export async function applyColorBy(key: FieldKey, numeric: boolean) {
  const { setLoading, setError } = useViewer.getState();
  try {
    setLoading({ label: "Reading element data", progress: 0 });
    const data = await openModelElements((_, p) => setLoading({ label: "Reading element data", progress: p }));
    const legend = colorLegend(data, key, numeric);
    await resetColors();
    for (const entry of legend) {
      const color = new THREE.Color(entry.color);
      for (const [modelId, ids] of Object.entries(entry.items)) await engine.getModel(modelId)?.setColor(ids, color);
    }
    useViewer.setState({ colorBy: { key, label: fieldLabel(key), numeric, legend, hidden: [] } });
  } catch (e) {
    setError(`Colouring failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setLoading(null);
    await engine.update(true);
  }
}

async function resetColors() {
  for (const model of engine.models.values()) await model.resetColor(undefined);
}

export async function clearColorBy() {
  const state = useViewer.getState().colorBy;
  await resetColors();
  if (state?.hidden.length) {
    for (const entry of state.legend) {
      if (!state.hidden.includes(entry.label)) continue;
      for (const [modelId, ids] of Object.entries(entry.items)) await engine.getModel(modelId)?.setVisible(ids, true);
    }
    useViewer.getState().bumpVisibility();
  }
  useViewer.setState({ colorBy: null });
  await engine.update(true);
}

export async function toggleLegendEntry(label: string) {
  const state = useViewer.getState().colorBy;
  const entry = state?.legend.find((e) => e.label === label);
  if (!state || !entry) return;
  const hide = !state.hidden.includes(label);
  for (const [modelId, ids] of Object.entries(entry.items)) await engine.getModel(modelId)?.setVisible(ids, !hide);
  useViewer.setState({ colorBy: { ...state, hidden: hide ? [...state.hidden, label] : state.hidden.filter((l) => l !== label) } });
  useViewer.getState().bumpVisibility();
  await engine.update(true);
}
