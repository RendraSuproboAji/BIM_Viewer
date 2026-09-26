import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { footprintAnchor, originMatrix, originTransform, toTrackingSpace, yawTowards } from "./placement";

const close = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-9) => a.distanceTo(b) < eps;

test("the hit point shows the model anchor, at any scale and yaw", () => {
  const anchor = new THREE.Vector3(120, 3, -45);
  const hit = new THREE.Vector3(0.4, 0.75, -1.2); // a table in the room
  for (const scale of [1, 1 / 50, 1 / 100]) {
    for (const yaw of [0, 0.7, -2]) {
      const m = originMatrix(originTransform(anchor, hit, scale, yaw));
      assert.ok(close(hit.clone().applyMatrix4(m), anchor), `scale ${scale}, yaw ${yaw}`);
    }
  }
});

test("one real metre spans 1/scale model metres", () => {
  const m = originMatrix(originTransform(new THREE.Vector3(), new THREE.Vector3(), 1 / 100, 0));
  const a = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
  const b = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
  assert.ok(Math.abs(a.distanceTo(b) - 100) < 1e-9);
});

test("tracking space round-trips through the origin", () => {
  const m = originMatrix(originTransform(new THREE.Vector3(5, 0, 5), new THREE.Vector3(1, 0, 1), 1 / 50, 1.1));
  const p = new THREE.Vector3(0.3, 1.6, -0.2);
  assert.ok(close(toTrackingSpace(p.clone().applyMatrix4(m), m), p, 1e-9));
});

test("footprint anchor is the centre of the box at ground level", () => {
  const anchor = footprintAnchor(new THREE.Box3(new THREE.Vector3(0, -2, 0), new THREE.Vector3(10, 8, 20)));
  assert.deepEqual(anchor.toArray(), [5, -2, 10]);
  assert.deepEqual(footprintAnchor(new THREE.Box3()).toArray(), [0, 0, 0]);
});

test("yaw towards a point straight ahead (-z) is zero", () => {
  assert.ok(Math.abs(yawTowards(new THREE.Vector3(), new THREE.Vector3(0, 0, -3))) < 1e-12);
});
