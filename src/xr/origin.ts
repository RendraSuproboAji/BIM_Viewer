import * as THREE from "three";
import { engine } from "../bim/engine";
import { framingBox } from "../bim/framing";
import { footprintAnchor, originMatrix, originTransform, toTrackingSpace, yawTowards, type OriginTransform } from "./placement";

/**
 * The XR origin (the user's tracking space in model coordinates), set imperatively:
 * placement, teleport and thumbstick locomotion all move it, so it isn't a React prop.
 */
let origin: THREE.Object3D | null = null;
let pending: OriginTransform | null = null;

export function registerOrigin(object: THREE.Object3D | null) {
  origin = object;
  if (origin && pending) {
    applyOrigin(pending);
    pending = null;
  }
}

export function applyOrigin(t: OriginTransform) {
  if (!origin) {
    pending = t;
    return;
  }
  origin.position.copy(t.position);
  origin.quaternion.copy(t.quaternion);
  origin.scale.setScalar(t.scale);
  origin.updateMatrixWorld(true);
  engine.requestRender();
}

/** The last placement, so a scale change keeps the model where it was put. */
let lastPlacement: { anchor: THREE.Vector3; hit: THREE.Vector3; yaw: number } | null = null;

/** Shows model point `anchor` at tracking-space point `hit`, at `scale`, turned by `yaw`. */
export function place(anchor: THREE.Vector3, hit: THREE.Vector3, scale: number, yaw: number) {
  lastPlacement = { anchor: anchor.clone(), hit: hit.clone(), yaw };
  applyOrigin(originTransform(anchor, hit, scale, yaw));
}

/** Re-applies the last placement at another scale. False if nothing was placed yet. */
export function rescale(scale: number) {
  if (!lastPlacement) return false;
  applyOrigin(originTransform(lastPlacement.anchor, lastPlacement.hit, scale, lastPlacement.yaw));
  return true;
}

export function resetPlacement() {
  lastPlacement = null;
}

export function currentOriginMatrix() {
  if (!origin) return new THREE.Matrix4();
  origin.updateMatrixWorld(true);
  return origin.matrixWorld.clone();
}

export function currentOriginScale() {
  return origin?.scale.x ?? 1;
}

/** The headset (camera) pose in tracking space: feet position and the yaw it faces. */
export function headInTrackingSpace(camera: THREE.Camera) {
  camera.updateMatrixWorld(true);
  const m = currentOriginMatrix();
  const head = toTrackingSpace(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), m);
  const ahead = toTrackingSpace(new THREE.Vector3(0, 0, -1).applyMatrix4(camera.matrixWorld), m);
  return { head, yaw: yawTowards(head, ahead) };
}

/** Box of the visible elements (ignoring stray far-away markers), like "Fit all". */
export async function modelBox() {
  const boxes: THREE.Box3[] = [];
  for (const model of engine.models.values()) {
    if (model.object.visible) boxes.push(...(await model.getBoxes(await model.getItemsByVisibility(true))));
  }
  return framingBox(boxes);
}

/**
 * Shows the model at `scale` as a table-top model about `distance` metres in
 * front of the user, its ground at `height` metres, turned to face them.
 */
export async function placeInFront(camera: THREE.Camera, scale: number, { distance = 0.8, height = 0.8 } = {}) {
  const box = await modelBox();
  const { head, yaw } = headInTrackingSpace(camera);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const hit = new THREE.Vector3(head.x, height, head.z).addScaledVector(forward, distance);
  place(footprintAnchor(box), hit, scale, yaw);
}

/**
 * VR start: 1:1, standing on the ground a few metres in front of the model
 * (on its +z side), facing it.
 */
export async function placeWalkthroughStart() {
  const box = await modelBox();
  if (box.isEmpty()) return place(new THREE.Vector3(), new THREE.Vector3(), 1, 0);
  const c = box.getCenter(new THREE.Vector3());
  place(new THREE.Vector3(c.x, box.min.y, box.max.z + 4), new THREE.Vector3(), 1, 0);
}

/** Teleports the user's feet to a model point, keeping their scale and heading. */
export function teleportTo(point: THREE.Vector3, camera: THREE.Camera) {
  const { head } = headInTrackingSpace(camera);
  const scale = 1 / currentOriginScale();
  const yaw = origin ? new THREE.Euler().setFromQuaternion(origin.quaternion, "YXZ").y : 0;
  place(point, new THREE.Vector3(head.x, 0, head.z), scale, yaw);
}

export { originMatrix };
