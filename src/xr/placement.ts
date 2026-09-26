import * as THREE from "three";

/**
 * Where to put the XR origin (the user's tracking space) so the model shows up
 * at the right place and scale.
 *
 * The model is never moved or scaled: clipping, picking and BIM coordinates stay
 * as they are. Instead the user's origin is transformed. Any point P in the
 * tracking (reference) space appears at `origin * P` in model space.
 *
 * To show model point `anchor` at real point `hit` (both on the ground or
 * table), at `scale` (0.01 = 1:100), turned by `yaw` around the vertical:
 *
 *   origin = T(anchor) · R(yaw) · S(1/scale) · T(-hit)
 *
 * so origin · hit = anchor, and one real metre spans 1/scale model metres.
 */
export interface OriginTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Uniform scale of the origin (1/scale). */
  scale: number;
}

export function originTransform(anchor: THREE.Vector3, hit: THREE.Vector3, scale: number, yaw = 0): OriginTransform {
  const s = 1 / scale;
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  // position = anchor − R·S·hit
  const offset = hit.clone().multiplyScalar(s).applyQuaternion(quaternion);
  return { position: anchor.clone().sub(offset), quaternion, scale: s };
}

export function originMatrix(t: OriginTransform) {
  return new THREE.Matrix4().compose(t.position, t.quaternion, new THREE.Vector3(t.scale, t.scale, t.scale));
}

/** Converts a model-space (world) point back into tracking space, given the current origin. */
export function toTrackingSpace(worldPoint: THREE.Vector3, currentOrigin: THREE.Matrix4) {
  return worldPoint.clone().applyMatrix4(currentOrigin.clone().invert());
}

/** The yaw (around the vertical) that faces from `from` towards `to`, both in tracking space. */
export function yawTowards(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/**
 * The model point to anchor on: the centre of the footprint at ground level
 * (the bottom of the model's main extent).
 */
export function footprintAnchor(box: THREE.Box3) {
  if (box.isEmpty()) return new THREE.Vector3();
  const c = box.getCenter(new THREE.Vector3());
  return new THREE.Vector3(c.x, box.min.y, c.z);
}
