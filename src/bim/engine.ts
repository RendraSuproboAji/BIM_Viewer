import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import { ALL_PRODUCT_CLASSES, EXTRA_DATA_CLASSES, EXTRA_RELATIONS } from "./ifc-classes";
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
      instanceCallback: includeEverything,
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
    releaseId(modelId);
  }

  /** Raycasts every visible model and returns the closest hit. */
  async pick(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: HTMLCanvasElement, clientX: number, clientY: number) {
    const mouse = new THREE.Vector2(clientX, clientY);
    let best: { modelId: string; hit: FRAGS.RaycastResult } | null = null;
    for (const [modelId, model] of this.fragments.list) {
      // Hidden models stay in the worker, so they would still be hit.
      if (!model.object.visible) continue;
      const hit = await model.raycast({ camera, mouse, dom });
      if (hit && (!best || hit.distance < best.hit.distance)) best = { modelId, hit };
    }
    return best;
  }
}

/**
 * That Open only converts a curated subset of IFC classes by default, which
 * silently drops e.g. IfcDistributionBoard, IfcLiquidTerminal, IfcSpatialZone,
 * IFC2X3 IfcElectricalElement, and non-single-value properties. Widen the
 * importer to every physical class of every schema plus the data MEP and
 * architecture workflows need (systems, openings/fillings, classifications).
 */
function includeEverything(importer: FRAGS.IfcImporter) {
  for (const id of ALL_PRODUCT_CLASSES) importer.classes.elements.add(id);
  for (const id of EXTRA_DATA_CLASSES) {
    if (!importer.classes.elements.has(id)) importer.classes.abstract.add(id);
  }
  for (const [rel, forRelating, forRelated] of EXTRA_RELATIONS) {
    importer.relations.set(rel, { forRelating, forRelated });
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

function releaseId(id: string) {
  usedIds.delete(id);
}

export const engine = new BimEngine();

// Handy for debugging from the browser console during development.
if (import.meta.env.DEV) (window as unknown as { __bim: BimEngine }).__bim = engine;

export const HIGHLIGHT: FRAGS.MaterialDefinition = {
  color: new THREE.Color("#ffb020"),
  renderedFaces: FRAGS.RenderedFaces.TWO,
  opacity: 1,
  transparent: false,
};
