import type { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import type { CameraState } from "../../shared/api";

/** The viewport registers its controls here so views can be saved and restored from outside the canvas. */
let controls: CameraControls | null = null;

export function registerControls(c: CameraControls | null) {
  controls = c;
}

export function getCameraState(): CameraState | null {
  if (!controls) return null;
  const position = controls.getPosition(new THREE.Vector3());
  const target = controls.getTarget(new THREE.Vector3());
  return { position: position.toArray(), target: target.toArray() };
}

export async function setCameraState(state: CameraState) {
  await controls?.setLookAt(...state.position, ...state.target, true);
}
