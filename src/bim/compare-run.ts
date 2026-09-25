import * as THREE from "three";
import { csvDocument } from "../../shared/csv";
import { select } from "./actions";
import { diffModels, type BoxesByGuid, type ModelDiff } from "./compare";
import { engine } from "./engine";
import { modelElements } from "./model-data";
import { useViewer } from "./store";

export const COMPARE_COLORS = { added: "#3fb950", changed: "#f0883e", removed: "#f85149" } as const;
const GHOST = 0.12;

export interface CompareRun {
  beforeId: string;
  afterId: string;
  diff: ModelDiff;
}

async function boxesByGuid(modelId: string): Promise<BoxesByGuid> {
  const model = engine.getModel(modelId)!;
  const elements = (await modelElements(model)).filter((e) => e.guid);
  const boxes = await model.getBoxes(elements.map((e) => e.localId));
  return new Map(elements.map((e, i) => [e.guid!, boxes[i]]));
}

/** Compares two open models (old → new) and colour-codes the differences. */
export async function runCompare(beforeId: string, afterId: string, toleranceMetres = 0.001) {
  const { setLoading, setError } = useViewer.getState();
  const before = engine.getModel(beforeId);
  const after = engine.getModel(afterId);
  if (!before || !after) return;
  try {
    setLoading({ label: "Comparing versions", progress: 0 });
    const [ea, eb, ba, bb] = await Promise.all([modelElements(before), modelElements(after), boxesByGuid(beforeId), boxesByGuid(afterId)]);
    const diff = diffModels(ea, eb, { before: ba, after: bb }, toleranceMetres);
    const run: CompareRun = { beforeId, afterId, diff };
    await applyCompareColors(run);
    useViewer.setState({ compareRun: run });
  } catch (e) {
    setError(`Comparison failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setLoading(null);
  }
}

async function applyCompareColors(run: CompareRun) {
  const before = engine.getModel(run.beforeId)!;
  const after = engine.getModel(run.afterId)!;
  for (const m of [before, after]) {
    await m.resetColor(undefined);
    await m.resetOpacity(undefined);
    await m.resetVisible();
    m.object.visible = true;
  }
  useViewer.setState((s) => ({ models: s.models.map((m) => (m.id === run.beforeId || m.id === run.afterId ? { ...m, visible: true } : m)) }));
  // New version: ghost everything, then colour what was added or changed.
  await after.setOpacity(undefined, GHOST);
  const added = run.diff.added.map((e) => e.localId);
  const changed = run.diff.changed.map((c) => c.after.localId);
  if (added.length) {
    await after.resetOpacity(added);
    await after.setColor(added, new THREE.Color(COMPARE_COLORS.added));
  }
  if (changed.length) {
    await after.resetOpacity(changed);
    await after.setColor(changed, new THREE.Color(COMPARE_COLORS.changed));
  }
  // Old version: only the removed elements, in red.
  await before.setVisible(undefined, false);
  const removed = run.diff.removed.map((e) => e.localId);
  if (removed.length) {
    await before.setVisible(removed, true);
    await before.setColor(removed, new THREE.Color(COMPARE_COLORS.removed));
  }
  useViewer.getState().bumpVisibility();
  await engine.update(true);
}

export async function clearCompare() {
  const run = useViewer.getState().compareRun;
  if (run) {
    for (const id of [run.beforeId, run.afterId]) {
      const m = engine.getModel(id);
      if (!m) continue;
      await m.resetColor(undefined);
      await m.resetOpacity(undefined);
      await m.resetVisible();
    }
    useViewer.getState().bumpVisibility();
  }
  useViewer.setState({ compareRun: null });
  await engine.update(true);
}

/** Selects and frames one element of the comparison (removed ones are shown from the old version). */
export async function focusCompared(modelId: string, localId: number) {
  await select({ modelId, localId });
  useViewer.getState().requestFit({ modelId, localIds: [localId] });
}

export function compareCsv(run: CompareRun) {
  const rows: unknown[][] = [["Change", "GlobalId", "Class", "Name", "Field", "Before", "After"]];
  for (const e of run.diff.added) rows.push(["Added", e.guid, e.category, e.name, "", "", ""]);
  for (const e of run.diff.removed) rows.push(["Removed", e.guid, e.category, e.name, "", "", ""]);
  for (const c of run.diff.changed) for (const f of c.changes) rows.push(["Changed", c.guid, c.after.category, c.after.name, f.field, f.before ?? "", f.after ?? ""]);
  return csvDocument(rows);
}
