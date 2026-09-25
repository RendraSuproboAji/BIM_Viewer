import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import type { IfcWorkerRequest, IfcWorkerResponse } from "./ifc-import";
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
  /** Section planes, applied per fragments material so the grid and gizmo stay unclipped. */
  private clippingPlanes: THREE.Plane[] = [];
  /**
   * The viewport renders on demand (R3F `frameloop="demand"`), not 60 times a second.
   * Anything that changes what fragments shows asks for a frame through this.
   */
  private renderRequester: (() => void) | null = null;

  constructor() {
    this.fragments = this.components.get(OBC.FragmentsManager);
    this.fragments.init(fragmentsWorkerUrl);

    // Avoid z-fighting between coplanar faces of different elements.
    this.fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
      // Materials created later (new models, highlights) inherit the current section.
      material.clippingPlanes = this.clippingPlanes.length ? this.clippingPlanes : null;
      if ("isLodMaterial" in material && material.isLodMaterial) return;
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    });

    // Geometry streams in from the worker after camera moves and edits: draw each change.
    this.fragments.list.onItemSet.add(({ value: model }) => {
      const redraw = () => this.requestRender();
      model.onViewUpdated.add(redraw);
      model.tiles.onItemSet.add(redraw);
      model.tiles.onItemUpdated.add(redraw);
      model.tiles.onItemDeleted.add(redraw);
    });
  }

  /** Registered by the viewport: R3F's `invalidate`. */
  setRenderRequester(requester: (() => void) | null) {
    this.renderRequester = requester;
  }

  requestRender() {
    this.renderRequester?.();
  }

  get models() {
    return this.fragments.list;
  }

  async loadIfc(buffer: ArrayBuffer, name: string, onProgress?: (p: number) => void) {
    const frag = await convertIfc(buffer, onProgress);
    return withModelId(name, (id) => this.fragments.core.load(frag, { modelId: id }));
  }

  async loadFrag(buffer: ArrayBuffer, name: string) {
    return withModelId(name, (id) => this.fragments.core.load(buffer, { modelId: id }));
  }

  getClippingPlanes() {
    return this.clippingPlanes;
  }

  /** Applies section planes to every fragments material (current and future). */
  setClippingPlanes(planes: THREE.Plane[]) {
    const toggled = planes.length !== this.clippingPlanes.length;
    this.clippingPlanes = planes;
    for (const material of this.fragments.core.models.materials.list.values()) {
      material.clippingPlanes = planes.length ? planes : null;
      // Changing the number of planes changes the shader program.
      if (toggled) material.needsUpdate = true;
    }
    for (const model of this.fragments.list.values()) model.getClippingPlanesEvent = () => this.clippingPlanes;
    this.requestRender();
  }

  getModel(modelId: string) {
    return this.fragments.list.get(modelId);
  }

  /**
   * Asks fragments to redraw/stream. This is only a render request, and the
   * underlying promise can stay pending forever when a model is disposed mid-update,
   * so callers never wait more than a second for it (a lost update must not
   * stall selection, sign-out or project switching).
   */
  update(force = false) {
    this.requestRender();
    const request = this.fragments.core.update(force).then(
      () => this.requestRender(),
      () => {},
    );
    return Promise.race([request, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
  }

  async disposeModel(modelId: string) {
    await this.fragments.core.disposeModel(modelId);
    releaseId(modelId);
    this.requestRender();
  }

  /**
   * Snapping pick for measurements: prefers vertices, then edges, then faces,
   * but only among hits at (about) the nearest surface, so it never snaps to a
   * corner hidden behind a wall. When the cursor is just off the geometry (e.g.
   * exactly on an outer corner, where the ray grazes past), nearby rays are
   * sampled and the closest vertex/edge on screen is used.
   */
  async snap(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: HTMLCanvasElement, clientX: number, clientY: number) {
    const exact = await this.snapAt(camera, dom, clientX, clientY);
    if (exact) return exact;
    const rect = dom.getBoundingClientRect();
    const RADIUS = 6;
    const MAX_SCREEN_DISTANCE = 12;
    let best: { point: [number, number, number]; kind: "vertex" | "edge" | "face"; score: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const hit = await this.snapAt(camera, dom, clientX + Math.cos(a) * RADIUS, clientY + Math.sin(a) * RADIUS);
      if (!hit || hit.kind === "face") continue;
      const p = new THREE.Vector3(...hit.point).project(camera);
      const sx = rect.left + ((p.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - p.y) / 2) * rect.height;
      const screenDistance = Math.hypot(sx - clientX, sy - clientY);
      if (screenDistance > MAX_SCREEN_DISTANCE) continue;
      // Vertices win over edges; then the closest on screen.
      const score = (hit.kind === "vertex" ? 0 : 100) + screenDistance;
      if (!best || score < best.score) best = { ...hit, score };
    }
    return best ? { point: best.point, kind: best.kind } : null;
  }

  private async snapAt(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: HTMLCanvasElement, clientX: number, clientY: number) {
    const mouse = new THREE.Vector2(clientX, clientY);
    const hits: FRAGS.RaycastResult[] = [];
    for (const model of this.fragments.list.values()) {
      if (!model.object.visible) continue;
      const results = await model.raycastWithSnapping({
        camera,
        mouse,
        dom,
        snappingClasses: [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE],
      });
      if (results) hits.push(...results);
    }
    if (!hits.length) return null;
    const nearest = Math.min(...hits.map((h) => h.distance));
    const priority = { [FRAGS.SnappingClass.POINT]: 0, [FRAGS.SnappingClass.LINE]: 1, [FRAGS.SnappingClass.FACE]: 2 };
    const best = hits
      .filter((h) => h.distance <= nearest * 1.02 + 0.05)
      .sort((a, b) => priority[a.snappingClass] - priority[b.snappingClass] || a.distance - b.distance)[0];
    const kind = best.snappingClass === FRAGS.SnappingClass.POINT ? "vertex" : best.snappingClass === FRAGS.SnappingClass.LINE ? "edge" : "face";
    return { point: best.point.toArray() as [number, number, number], kind: kind as "vertex" | "edge" | "face" };
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

/** Reserves a unique model id for a load, releasing it again if the load fails. */
async function withModelId<T>(name: string, load: (id: string) => Promise<T>) {
  const id = uniqueId(name);
  try {
    return await load(id);
  } catch (e) {
    releaseId(id);
    throw e;
  }
}

/** Converts IFC bytes to Fragments bytes in a dedicated worker (one per conversion, so memory is released). */
function convertIfc(buffer: ArrayBuffer, onProgress?: (p: number) => void) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL("./ifc-worker.ts", import.meta.url), { type: "module" });
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") onProgress?.(msg.progress);
      else if (msg.type === "done") {
        finish();
        resolve(msg.bytes);
      } else {
        finish();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The IFC conversion worker failed to start"));
    };
    const bytes = new Uint8Array(buffer);
    const request: IfcWorkerRequest = {
      bytes,
      // Absolute, because the worker resolves relative URLs against its own script.
      wasmPath: new URL(`${import.meta.env.BASE_URL}web-ifc/`, location.href).href,
    };
    worker.postMessage(request, [bytes.buffer]);
  });
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
