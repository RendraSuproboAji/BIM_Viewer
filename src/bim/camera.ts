import type { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import type { CameraState } from "../../shared/api";

/** The viewport registers its controls here so views can be saved and restored from outside the canvas. */
let controls: CameraControls | null = null;

export function registerControls(c: CameraControls | null) {
  controls = c;
  // Handy for debugging from the browser console during development.
  if (import.meta.env.DEV) (window as unknown as { __bimControls: CameraControls | null }).__bimControls = c;
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

/** Renderer, scene and camera of the canvas, for snapshots and BCF viewpoints. */
export interface RendererHandle {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}
let renderer: RendererHandle | null = null;

export function registerRenderer(handle: RendererHandle | null) {
  renderer = handle;
}

export function getRenderer() {
  return renderer;
}

export async function setCameraLookAt(position: THREE.Vector3, target: THREE.Vector3, up?: THREE.Vector3) {
  if (!controls) return;
  if (up && up.lengthSq() > 0) {
    controls.camera.up.copy(up).normalize();
    controls.updateCameraUp();
  }
  await controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, true);
}
