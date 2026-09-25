import * as THREE from "three";
import type { BcfCamera, BcfClippingPlane, IssueViewpoint, ViewState } from "../../shared/api";
import { getCameraState, getRenderer, setCameraLookAt } from "./camera";
import { engine } from "./engine";
import { captureView, applyView } from "./library";
import { useViewer, type SectionAxis } from "./store";

/**
 * Viewpoints for issues: the exact viewer state (restored by this app) plus an
 * interoperable BCF camera and clipping planes in IFC coordinates.
 *
 * The viewer is Y-up, with models moved near the origin: web-ifc maps IFC
 * (x, y, z) to (x, z, -y), and That Open subtracts each model's coordination
 * offset, aligning all models to the first one's ("base coordinates").
 */

function baseMatrix() {
  const base = engine.fragments.core.baseCoordinates;
  const m = new THREE.Matrix4();
  if (!base || base.length < 9) return m;
  const [x, y, z, xx, xy, xz, yx, yy, yz] = base;
  const xDir = new THREE.Vector3(xx, xy, xz);
  const yDir = new THREE.Vector3(yx, yy, yz);
  // Unset axes default to identity.
  if (xDir.lengthSq() === 0) xDir.set(1, 0, 0);
  if (yDir.lengthSq() === 0) yDir.set(0, 1, 0);
  const zDir = new THREE.Vector3().crossVectors(xDir, yDir);
  m.set(xDir.x, yDir.x, zDir.x, x, xDir.y, yDir.y, zDir.y, y, xDir.z, yDir.z, zDir.z, z, 0, 0, 0, 1);
  return m;
}

const yUpToIfc = (v: THREE.Vector3): [number, number, number] => [v.x, -v.z, v.y];
const ifcToYUp = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x, z, -y);
const round = (v: [number, number, number]) => v.map((n) => Math.round(n * 1e6) / 1e6) as [number, number, number];

export function toIfcPoint(p: THREE.Vector3) {
  return round(yUpToIfc(p.clone().applyMatrix4(baseMatrix())));
}
export function toIfcDirection(d: THREE.Vector3) {
  return round(yUpToIfc(d.clone().transformDirection(baseMatrix())));
}
export function fromIfcPoint(p: [number, number, number]) {
  return ifcToYUp(p).applyMatrix4(baseMatrix().invert());
}
export function fromIfcDirection(d: [number, number, number]) {
  return ifcToYUp(d).transformDirection(baseMatrix().invert());
}

/** BCF camera + clipping planes for the current view. */
export function currentBcfViewpoint(): IssueViewpoint["bcf"] | null {
  const r = getRenderer();
  if (!r) return null;
  const cam = r.camera as THREE.PerspectiveCamera;
  cam.updateMatrixWorld();
  const camera: BcfCamera = {
    viewPoint: toIfcPoint(cam.position),
    direction: toIfcDirection(cam.getWorldDirection(new THREE.Vector3())),
    upVector: toIfcDirection(new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion)),
    fieldOfView: Math.round(cam.fov * 100) / 100,
  };
  // BCF clipping directions point at the removed side; three.js planes keep the side their normal points to.
  const clippingPlanes: BcfClippingPlane[] = engine.getClippingPlanes().map((plane) => ({
    location: toIfcPoint(plane.coplanarPoint(new THREE.Vector3())),
    direction: toIfcDirection(plane.normal.clone().negate()),
  }));
  return { camera, clippingPlanes };
}

/** Viewpoint for a new issue: exact viewer state plus its BCF form. */
export function captureViewpoint(): IssueViewpoint | null {
  const viewer = captureView();
  const bcf = currentBcfViewpoint();
  if (!viewer && !bcf) return null;
  return { ...(viewer ? { viewer } : {}), ...(bcf ? { bcf } : {}) };
}

/** PNG screenshot of the 3D view (base64, no data: prefix), at most 1280 px wide. */
export function captureSnapshot(maxWidth = 1280): string | null {
  const r = getRenderer();
  if (!r) return null;
  // The drawing buffer is only valid right after a render, so render and read in the same task.
  r.gl.render(r.scene, r.camera);
  const source = r.gl.domElement;
  const scale = Math.min(1, maxWidth / source.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1] ?? null;
}

/** Restores an issue viewpoint: the exact state when available, otherwise the BCF camera and planes. */
export async function applyViewpoint(viewpoint: IssueViewpoint | null) {
  if (!viewpoint) return;
  if (viewpoint.viewer) return applyView(viewpoint.viewer as ViewState);
  const bcf = viewpoint.bcf;
  if (!bcf) return;
  const position = fromIfcPoint(bcf.camera.viewPoint);
  const direction = fromIfcDirection(bcf.camera.direction).normalize();
  // Look at a point in front of the camera: the model centre's distance if known.
  const box = new THREE.Box3();
  for (const m of engine.models.values()) box.union(m.box);
  const distance = box.isEmpty() ? 10 : Math.max(1, position.distanceTo(box.getCenter(new THREE.Vector3())));
  const target = position.clone().addScaledVector(direction, distance);
  await setCameraLookAt(position, target, fromIfcDirection(bcf.camera.upVector));
  useViewer.getState().setSection(sectionFromPlanes(bcf.clippingPlanes, box));
}

/** Maps an axis-aligned BCF clipping plane onto the viewer's section tool (others are ignored). */
function sectionFromPlanes(planes: BcfClippingPlane[], box: THREE.Box3) {
  const off = { enabled: false, axis: "y" as SectionAxis, offset: 0.5, flipped: false };
  if (!planes.length || box.isEmpty()) return off;
  const plane = planes[0];
  // Kept side (three.js normal) is opposite the BCF direction.
  const keep = fromIfcDirection(plane.direction).negate();
  const point = fromIfcPoint(plane.location);
  const axes: SectionAxis[] = ["x", "y", "z"];
  const index = [Math.abs(keep.x), Math.abs(keep.y), Math.abs(keep.z)].findIndex((c) => c > 0.999);
  if (index < 0) return off;
  const min = box.min.getComponent(index);
  const max = box.max.getComponent(index);
  const offset = THREE.MathUtils.clamp((point.getComponent(index) - min) / (max - min || 1), 0, 1);
  // Unflipped keeps the lower side (normal pointing to -axis).
  return { enabled: true, axis: axes[index], offset, flipped: keep.getComponent(index) > 0 };
}

export { getCameraState };
