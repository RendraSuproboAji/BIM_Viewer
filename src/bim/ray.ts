import * as THREE from "three";

/** A 2×2 px stand-in for the canvas, used to cast screen-space raycasts along a 3D ray. */
export const RAY_CANVAS = {
  clientWidth: 2,
  clientHeight: 2,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 2, bottom: 2, width: 2, height: 2, x: 0, y: 0, toJSON() {} }),
} as unknown as HTMLCanvasElement;

/** A narrow camera at the ray's origin, looking along it (a new one per call: picks are async). */
export function rayCamera(ray: THREE.Ray) {
  const camera = new THREE.PerspectiveCamera(0.5, 1, 0.01, 100000);
  camera.position.copy(ray.origin);
  // lookAt is degenerate when the ray is parallel to the up vector.
  if (Math.abs(ray.direction.y) > 0.999) camera.up.set(0, 0, -1);
  camera.lookAt(ray.origin.clone().add(ray.direction));
  camera.updateMatrixWorld(true);
  return camera;
}
