import * as THREE from "three";

/**
 * The box to frame for a set of element boxes, ignoring stray outliers.
 *
 * IFC files often place tiny helper objects (origin / geo-reference markers,
 * survey points) far from the building. Framing their full extent leaves the
 * building as a speck in a corner. Here the "core" of the model is the 10th–90th
 * percentile of element centres on each axis; elements whose centre lies more
 * than one core-size beyond it are left out. Small sets are framed whole.
 */
export function framingBox(boxes: THREE.Box3[]): THREE.Box3 {
  const valid = boxes.filter((b) => !b.isEmpty());
  const all = new THREE.Box3();
  for (const b of valid) all.union(b);
  if (valid.length < 8) return all;

  const centres = valid.map((b) => b.getCenter(new THREE.Vector3()));
  const low = new THREE.Vector3();
  const high = new THREE.Vector3();
  for (const axis of ["x", "y", "z"] as const) {
    const sorted = centres.map((c) => c[axis]).sort((a, b) => a - b);
    const lo = sorted[Math.floor((sorted.length - 1) * 0.1)];
    const hi = sorted[Math.ceil((sorted.length - 1) * 0.9)];
    // At least 1 m, so flat or single-row models keep elements at their edges.
    const margin = Math.max(hi - lo, 1);
    low[axis] = lo - margin;
    high[axis] = hi + margin;
  }
  const core = new THREE.Box3(low, high);
  const framed = new THREE.Box3();
  valid.forEach((b, i) => {
    if (core.containsPoint(centres[i])) framed.union(b);
  });
  return framed.isEmpty() ? all : framed;
}
