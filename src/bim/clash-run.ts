import * as THREE from "three";
import type { ElementRecord } from "../../shared/api";
import { api } from "../api/client";
import { select } from "./actions";
import { detectClashes, type ClashItem, type ClashMode, type ClashResult } from "./clash";
import { engine } from "./engine";
import { disciplineOf, type Discipline } from "./ifc-classes";
import { modelElements } from "./model-data";
import { useViewer } from "./store";
import { captureSnapshot, captureViewpoint } from "./viewpoint";

/** Disciplines that can take part in clash tests (spaces and openings aren't physical). */
export const CLASH_DISCIPLINES: Discipline[] = ["Architecture", "Structure", "MEP", "Infrastructure", "Other"];

export interface ClashElement extends ClashItem {
  modelId: string;
  localId: number;
  guid: string | null;
  name: string | null;
  category: string;
}

export interface ClashRun {
  /** Increments per run (lets the UI and tests tell runs apart). */
  id: number;
  setA: Discipline[];
  setB: Discipline[];
  mode: ClashMode;
  tolerance: number;
  results: ClashResult<ClashElement>[];
  /** Issue number per result index, once reported. */
  reported: Record<number, number>;
  durationMs: number;
  candidates: number;
}

let cancelRequested = false;
let runCounter = 0;
export function cancelClashRun() {
  cancelRequested = true;
}

async function collect(sets: [Discipline[], Discipline[]]) {
  const a: ClashElement[] = [];
  const b: ClashElement[] = [];
  for (const [modelId, model] of engine.models) {
    if (!model.object.visible) continue;
    const elements = await modelElements(model);
    const hidden = new Set(await model.getItemsByVisibility(false));
    const picked: [ElementRecord, boolean, boolean][] = [];
    for (const e of elements) {
      if (hidden.has(e.localId)) continue; // hidden elements are left out, like in the view
      const d = disciplineOf(e.category);
      const inA = sets[0].includes(d);
      const inB = sets[1].includes(d);
      if (inA || inB) picked.push([e, inA, inB]);
    }
    if (!picked.length) continue;
    const boxes = await model.getBoxes(picked.map(([e]) => e.localId));
    picked.forEach(([e, inA, inB], i) => {
      const box = boxes[i];
      if (!box || box.isEmpty()) return;
      const item: ClashElement = { key: `${modelId}:${e.localId}`, box, modelId, localId: e.localId, guid: e.guid, name: e.name, category: e.category };
      if (inA) a.push(item);
      if (inB) b.push(item);
    });
  }
  return [a, b] as const;
}

/** World-space mesh of one element (all its representations merged). */
async function geometryOf(item: ClashElement) {
  const model = engine.getModel(item.modelId);
  if (!model) return null;
  const [meshes] = await model.getItemsGeometry([item.localId]);
  if (!meshes?.length) return null;
  const world = model.object.matrixWorld;
  const positions: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    if (!mesh.positions || !mesh.indices) continue;
    const m = new THREE.Matrix4().multiplyMatrices(world, mesh.transform);
    const offset = positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      v.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
    }
    for (const index of mesh.indices) indices.push(index + offset);
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export async function runClashDetection(setA: Discipline[], setB: Discipline[], mode: ClashMode, tolerance: number) {
  const { setLoading, setError } = useViewer.getState();
  cancelRequested = false;
  const started = performance.now();
  try {
    setLoading({ label: "Clash detection: collecting elements", progress: 0 });
    const [a, b] = await collect([setA, setB]);
    let candidates = 0;
    const results = await detectClashes(
      a,
      b,
      geometryOf,
      { mode, tolerance },
      (done, total) => {
        candidates = total;
        setLoading({ label: `Clash detection: testing ${done} / ${total} candidate pairs`, progress: total ? done / total : 1 });
      },
      () => cancelRequested,
    );
    results.sort((x, y) => x.a.category.localeCompare(y.a.category) || x.b.category.localeCompare(y.b.category) || x.distance - y.distance);
    const run: ClashRun = { id: ++runCounter, setA, setB, mode, tolerance, results, reported: {}, durationMs: performance.now() - started, candidates };
    useViewer.setState({ clashRun: run });
    if (cancelRequested) setError(`Clash detection cancelled: ${results.length} clash(es) found so far.`);
  } catch (e) {
    setError(`Clash detection failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setLoading(null);
  }
}

/** Isolates the two elements, colours them (A orange, B blue) and frames the clash. */
export async function focusClash(clash: ClashResult<ClashElement>) {
  await clearClashFocus();
  for (const [id, model] of engine.models) {
    await model.setVisible(undefined, false);
    const ids = [clash.a, clash.b].filter((e) => e.modelId === id).map((e) => e.localId);
    if (ids.length) await model.setVisible(ids, true);
  }
  await engine.getModel(clash.b.modelId)?.setColor([clash.b.localId], new THREE.Color("#2f81f7"));
  await select({ modelId: clash.a.modelId, localId: clash.a.localId });
  useViewer.getState().bumpVisibility();
  // Frame the clash point, sized to the pair but capped (long pipes would zoom far out).
  const size = clash.a.box.clone().union(clash.b.box).getSize(new THREE.Vector3()).clampScalar(1, 6);
  const focus = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...clash.point), size);
  useViewer.getState().requestFit({ box: [focus.min.toArray(), focus.max.toArray()] });
  await engine.update(true);
}

export async function clearClashFocus() {
  for (const model of engine.models.values()) {
    await model.resetVisible();
    await model.resetColor(undefined);
  }
  useViewer.getState().bumpVisibility();
  await engine.update(true);
}

/** Creates a "clash" issue for a result (focuses it first so the snapshot shows it). */
export async function reportClash(index: number) {
  const { clashRun, projectId } = useViewer.getState();
  const clash = clashRun?.results[index];
  if (!clash || !clashRun || !projectId) throw new Error("Open a project to report clashes");
  await focusClash(clash);
  await new Promise((r) => setTimeout(r, 900)); // let the camera settle for the snapshot
  const libraryOf = (modelId: string) => useViewer.getState().models.find((m) => m.id === modelId)?.libraryId ?? null;
  const label = (e: ClashElement) => e.name || e.category.replace(/^IFC/, "");
  const issue = await api.createIssue({
    projectId,
    title: `Clash: ${label(clash.a)} × ${label(clash.b)}`.slice(0, 255),
    description:
      clash.distance > 0
        ? `Clearance clash: ${(clash.distance * 1000).toFixed(0)} mm apart (required ${(clashRun.tolerance * 1000).toFixed(0)} mm).`
        : `Hard clash (intersecting geometry).`,
    type: "clash",
    priority: "normal",
    labels: ["clash"],
    components: [clash.a, clash.b]
      .filter((e) => e.guid)
      .map((e) => ({ modelId: libraryOf(e.modelId), guid: e.guid!, name: e.name, category: e.category })),
    viewpoint: captureViewpoint(),
    snapshot: captureSnapshot(),
  });
  const current = useViewer.getState().clashRun;
  if (current === clashRun) useViewer.setState({ clashRun: { ...current, reported: { ...current.reported, [index]: issue.number } } });
  useViewer.getState().bumpLibrary();
  return issue;
}
