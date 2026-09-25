import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
// Vite resolves this to a served URL for the Fragments web worker.
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";

/**
 * Thin wrapper around That Open Engine.
 *
 * Rendering (renderer, scene, camera, controls) is owned by React Three Fiber.
 * That Open is used only for what it is best at: converting IFC to Fragments,
 * streaming geometry from a worker, and querying BIM data.
 */
class BimEngine {
  readonly components = new OBC.Components();
  readonly fragments: OBC.FragmentsManager;
  readonly ifcLoader: OBC.IfcLoader;
  private ifcReady: Promise<void> | null = null;

  constructor() {
    this.fragments = this.components.get(OBC.FragmentsManager);
    this.fragments.init(fragmentsWorkerUrl);

    // Avoid z-fighting between coplanar faces of different elements.
    this.fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
      if ("isLodMaterial" in material && material.isLodMaterial) return;
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    });

    this.ifcLoader = this.components.get(OBC.IfcLoader);
  }

  get models() {
    return this.fragments.list;
  }

  private setupIfc() {
    this.ifcReady ??= this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: { path: `${import.meta.env.BASE_URL}web-ifc/`, absolute: true },
    });
    return this.ifcReady;
  }

  async loadIfc(buffer: ArrayBuffer, name: string, onProgress?: (p: number) => void) {
    await this.setupIfc();
    return this.ifcLoader.load(new Uint8Array(buffer), true, uniqueId(name), {
      processData: {
        progressCallback: (progress: number) => onProgress?.(progress),
      },
    });
  }

  async loadFrag(buffer: ArrayBuffer, name: string) {
    return this.fragments.core.load(buffer, { modelId: uniqueId(name) });
  }

  getModel(modelId: string) {
    return this.fragments.list.get(modelId);
  }

  update(force = false) {
    return this.fragments.core.update(force);
  }

  async disposeModel(modelId: string) {
    await this.fragments.core.disposeModel(modelId);
  }

  /** Raycasts every loaded model and returns the closest hit. */
  async pick(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: HTMLCanvasElement, clientX: number, clientY: number) {
    const mouse = new THREE.Vector2(clientX, clientY);
    let best: { modelId: string; hit: FRAGS.RaycastResult } | null = null;
    for (const [modelId, model] of this.fragments.list) {
      const hit = await model.raycast({ camera, mouse, dom });
      if (hit && (!best || hit.distance < best.hit.distance)) best = { modelId, hit };
    }
    return best;
  }
}

const usedIds = new Set<string>();
function uniqueId(name: string) {
  const base = name.replace(/\.(ifc|frag)$/i, "") || "model";
  let id = base;
  for (let i = 2; usedIds.has(id); i++) id = `${base} (${i})`;
  usedIds.add(id);
  return id;
}

export const engine = new BimEngine();

export const HIGHLIGHT: FRAGS.MaterialDefinition = {
  color: new THREE.Color("#ffb020"),
  renderedFaces: FRAGS.RenderedFaces.TWO,
  opacity: 1,
  transparent: false,
};
