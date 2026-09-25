import * as THREE from "three";

export type MeasureTool = "distance" | "area" | "angle";
export type Point = [number, number, number];
export type SnapKind = "vertex" | "edge" | "face";

export interface Measurement {
  id: number;
  kind: MeasureTool;
  points: Point[];
}

/** Points needed to complete a measurement (area is open-ended, min 3). */
export const REQUIRED_POINTS: Record<MeasureTool, number> = { distance: 2, angle: 3, area: 3 };

const v = (p: Point) => new THREE.Vector3(...p);

export function distance(a: Point, b: Point) {
  return v(a).distanceTo(v(b));
}

/** Total length along the points (perimeter when closed). */
export function polylineLength(points: Point[], closed = false) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  if (closed && points.length > 2) total += distance(points[points.length - 1], points[0]);
  return total;
}

/** Area of a planar polygon in 3D (half the length of the summed cross products). */
export function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;
  const sum = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    sum.add(new THREE.Vector3().crossVectors(v(points[i]), v(points[(i + 1) % points.length])));
  }
  return sum.length() / 2;
}

/** Angle at the middle point, in degrees. */
export function angleAt(a: Point, vertex: Point, b: Point) {
  const u = v(a).sub(v(vertex));
  const w = v(b).sub(v(vertex));
  if (u.lengthSq() === 0 || w.lengthSq() === 0) return 0;
  return THREE.MathUtils.radToDeg(u.angleTo(w));
}

export function centroid(points: Point[]): Point {
  const c = new THREE.Vector3();
  for (const p of points) c.add(v(p));
  return c.divideScalar(Math.max(1, points.length)).toArray();
}

export function midpoint(a: Point, b: Point): Point {
  return v(a).add(v(b)).multiplyScalar(0.5).toArray();
}

/** Human-readable value. Models are converted to metres by web-ifc. */
export function formatMeasurement(m: Pick<Measurement, "kind" | "points">) {
  if (m.kind === "distance") {
    const [a, b] = m.points;
    return formatLength(distance(a, b));
  }
  if (m.kind === "angle") return `${angleAt(m.points[0], m.points[1], m.points[2]).toFixed(1)}°`;
  return `${polygonArea(m.points).toFixed(2)} m²`;
}

export function formatLength(metres: number) {
  return metres < 1 ? `${(metres * 1000).toFixed(0)} mm` : `${metres.toFixed(3)} m`;
}

/** Axis components of a distance (Δx, Δy, Δz in the viewer's Y-up frame, reported as plan X/Y and height). */
export function deltas(a: Point, b: Point) {
  return { dx: Math.abs(b[0] - a[0]), dy: Math.abs(b[2] - a[2]), dz: Math.abs(b[1] - a[1]) };
}
