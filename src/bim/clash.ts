import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

/**
 * Clash detection between two sets of elements (e.g. architecture/structure vs MEP).
 *
 * 1. Broad phase: sort-and-sweep over world bounding boxes (expanded by the
 *    clearance) finds candidate pairs in O(n log n + k).
 * 2. Narrow phase: exact triangle meshes with a BVH (three-mesh-bvh):
 *    - "hard": the meshes intersect, and their boxes overlap by more than the
 *      tolerance on every axis (so elements that merely touch, like a wall
 *      standing on a slab, are not reported);
 *    - "clearance": the true minimum distance between the meshes is below the
 *      tolerance (intersections count as distance 0).
 *
 * Pipes passing through walls don't clash when the wall has an opening: the
 * opening is already cut out of the wall's mesh.
 */

export interface ClashItem {
  /** Unique id, e.g. "modelId:localId". */
  key: string;
  box: THREE.Box3;
}

export type ClashMode = "hard" | "clearance";

export interface ClashOptions {
  mode: ClashMode;
  /** Metres. Hard: ignore overlaps shallower than this. Clearance: report closer than this. */
  tolerance: number;
}

export interface ClashResult<T extends ClashItem = ClashItem> {
  a: T;
  b: T;
  /** Where to look: centre of the overlap (hard) or midpoint of the closest points (clearance). */
  point: [number, number, number];
  /** Minimum distance in metres (0 when intersecting). */
  distance: number;
}

/** Candidate pairs whose boxes, grown by `margin`, overlap. Sort-and-sweep on X. */
export function candidatePairs<T extends ClashItem>(setA: T[], setB: T[], margin = 0): [T, T][] {
  type Entry = { item: T; side: 0 | 1; min: number; max: number };
  const entries: Entry[] = [
    ...setA.map((item) => ({ item, side: 0 as const, min: item.box.min.x - margin, max: item.box.max.x + margin })),
    ...setB.map((item) => ({ item, side: 1 as const, min: item.box.min.x - margin, max: item.box.max.x + margin })),
  ].sort((p, q) => p.min - q.min);
  const pairs: [T, T][] = [];
  const seen = new Set<string>();
  const active: Entry[] = [];
  for (const e of entries) {
    // Drop entries that end before this one starts.
    for (let i = active.length - 1; i >= 0; i--) if (active[i].max < e.min) active.splice(i, 1);
    for (const other of active) {
      if (other.side === e.side || other.item.key === e.item.key) continue;
      const [a, b] = e.side === 0 ? [e.item, other.item] : [other.item, e.item];
      if (!boxesOverlap(a.box, b.box, margin)) continue;
      const id = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
      if (seen.has(id)) continue; // an element can be in both sets
      seen.add(id);
      pairs.push([a, b]);
    }
    active.push(e);
  }
  return pairs;
}

function boxesOverlap(a: THREE.Box3, b: THREE.Box3, margin: number) {
  return (
    a.min.x - margin <= b.max.x && a.max.x + margin >= b.min.x &&
    a.min.y - margin <= b.max.y && a.max.y + margin >= b.min.y &&
    a.min.z - margin <= b.max.z && a.max.z + margin >= b.min.z
  );
}

/** Smallest overlap of the two boxes along any axis (≤ 0 when they don't overlap). */
function overlapDepth(a: THREE.Box3, b: THREE.Box3) {
  return Math.min(
    Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
    Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y),
    Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
  );
}

const IDENTITY = new THREE.Matrix4();

export interface Geometry {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
}

export function makeGeometry(geometry: THREE.BufferGeometry): Geometry {
  return { geometry, bvh: new MeshBVH(geometry) };
}

/** Exact test of one candidate pair (both geometries in world space). */
export function testPair(a: Geometry, b: Geometry, boxA: THREE.Box3, boxB: THREE.Box3, options: ClashOptions): { point: [number, number, number]; distance: number } | null {
  if (options.mode === "hard") {
    if (overlapDepth(boxA, boxB) <= options.tolerance) return null;
    if (!a.bvh.intersectsGeometry(b.geometry, IDENTITY)) return null;
    const overlap = boxA.clone().intersect(boxB);
    return { point: overlap.getCenter(new THREE.Vector3()).toArray(), distance: 0 };
  }
  const onA = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const onB = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  if (a.bvh.intersectsGeometry(b.geometry, IDENTITY)) {
    const overlap = boxA.clone().intersect(boxB);
    return { point: overlap.getCenter(new THREE.Vector3()).toArray(), distance: 0 };
  }
  const found = a.bvh.closestPointToGeometry(b.geometry, IDENTITY, onA, onB, 0, options.tolerance);
  if (!found || onA.distance > options.tolerance) return null;
  return { point: onA.point.clone().add(onB.point).multiplyScalar(0.5).toArray(), distance: onA.distance };
}

/**
 * Runs the full detection. `geometryOf` loads an item's world-space mesh (cached here per run).
 * Yields to the UI between batches and can be cancelled.
 */
export async function detectClashes<T extends ClashItem>(
  setA: T[],
  setB: T[],
  geometryOf: (item: T) => Promise<THREE.BufferGeometry | null>,
  options: ClashOptions,
  onProgress?: (done: number, total: number) => void,
  cancelled?: () => boolean,
): Promise<ClashResult<T>[]> {
  const margin = options.mode === "clearance" ? options.tolerance : 0;
  const pairs = candidatePairs(setA, setB, margin);
  const cache = new Map<string, Promise<Geometry | null>>();
  const load = (item: T) => {
    let g = cache.get(item.key);
    if (!g) {
      g = geometryOf(item).then((geometry) => (geometry && geometry.attributes.position?.count ? makeGeometry(geometry) : null));
      cache.set(item.key, g);
    }
    return g;
  };
  const results: ClashResult<T>[] = [];
  let lastYield = performance.now();
  for (let i = 0; i < pairs.length; i++) {
    if (cancelled?.()) break;
    const [a, b] = pairs[i];
    const [ga, gb] = await Promise.all([load(a), load(b)]);
    if (ga && gb) {
      const hit = testPair(ga, gb, a.box, b.box, options);
      if (hit) results.push({ a, b, ...hit });
    }
    if (performance.now() - lastYield > 30) {
      onProgress?.(i + 1, pairs.length);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  onProgress?.(pairs.length, pairs.length);
  for (const g of cache.values()) void g.then((x) => x?.geometry.dispose());
  return results;
}
