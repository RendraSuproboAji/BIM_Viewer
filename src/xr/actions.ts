import * as THREE from "three";
import { select } from "../bim/actions";
import { engine } from "../bim/engine";
import { distance } from "../bim/measure";
import { useViewer } from "../bim/store";
import { teleportTo } from "./origin";
import { useXRUi } from "./state";

/**
 * What a controller/hand/screen "select" (trigger, pinch, tap) does in XR:
 * place the model (while placing), add a measurement point (measure tool),
 * or select the BIM element the ray points at.
 */

/** Set by the placement while the user is choosing where the model goes. */
let placementHandler: (() => boolean) | null = null;
export function setPlacementHandler(handler: (() => boolean) | null) {
  placementHandler = handler;
}

/** Pointer-downs on 3D UI (wrist menu, info card) swallow the select that follows. */
let lastUiPress = 0;
export function markUiPress() {
  lastUiPress = performance.now();
}
const pressedUi = () => performance.now() - lastUiPress < 600;

/** Serialised: picks are async and quick double-pinches must not interleave. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (step: () => Promise<unknown>) => (queue = queue.then(step).catch(() => {}));

export function handleSelect(ray: THREE.Ray) {
  if (pressedUi()) return;
  if (placementHandler?.()) return;
  enqueue(async () => {
    const { tool } = useViewer.getState();
    if (tool === "distance") return addMeasurePoint(ray);
    const result = await engine.pickRay(ray);
    await select(result ? { modelId: result.modelId, localId: result.hit.localId } : null);
  });
}

async function addMeasurePoint(ray: THREE.Ray) {
  const snap = await engine.snapRay(ray);
  if (!snap) return;
  const { draft, setDraft, addMeasurement } = useViewer.getState();
  const points = [...draft, snap.point];
  if (points.length < 2) return setDraft(points);
  addMeasurement({ kind: "distance", points });
  useXRUi.setState({ lastDistance: distance(points[0], points[1]) });
}

/** Squeeze (grip) in VR: teleport onto a floor-like surface the ray points at. */
export function handleSqueeze(ray: THREE.Ray, camera: THREE.Camera) {
  if (useXRUi.getState().mode !== "vr") return;
  enqueue(async () => {
    const result = await engine.pickRay(ray);
    if (!result) return;
    const normal = result.hit.normal;
    if (normal && normal.y < 0.7) return; // walls and ceilings aren't floors
    teleportTo(result.hit.point, camera);
  });
}
