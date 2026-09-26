import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { rayCamera } from "./ray";

/** Where a world point lands in normalised device coordinates of the ray camera. */
const ndc = (camera: THREE.PerspectiveCamera, p: THREE.Vector3) => p.clone().project(camera);

test("the ray camera looks exactly along the ray", () => {
  for (const dir of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.3, -0.5, -1).normalize(), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]) {
    const ray = new THREE.Ray(new THREE.Vector3(2, 1.6, -3), dir);
    const camera = rayCamera(ray);
    const ahead = ndc(camera, ray.at(10, new THREE.Vector3()));
    assert.ok(Math.abs(ahead.x) < 1e-6 && Math.abs(ahead.y) < 1e-6, `${dir.toArray()} -> ${ahead.toArray()}`);
    assert.ok(ahead.z > -1 && ahead.z < 1, "in front of the camera");
  }
});

test("points off the ray fall outside its narrow view", () => {
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  const aside = ndc(rayCamera(ray), new THREE.Vector3(0.5, 0, -10));
  assert.ok(Math.abs(aside.x) > 1);
});
