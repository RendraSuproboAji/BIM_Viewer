import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { framingBox } from "./framing";

const box = (x: number, y: number, z: number, size = 1) =>
  new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + size, y + size, z + size));

/** A 10 × 10 m "building" made of 25 elements. */
const building = () => {
  const out: THREE.Box3[] = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) out.push(box(i * 2, 0, j * 2));
  return out;
};

test("a far-away marker is left out of the framed box", () => {
  const framed = framingBox([...building(), box(500, 0, -300, 0.1)]);
  assert.deepEqual(framed.min.toArray(), [0, 0, 0]);
  assert.deepEqual(framed.max.toArray(), [9, 1, 9]);
});

test("elements at the edges of the building are kept", () => {
  const framed = framingBox([...building(), box(-3, 0, 4), box(12, 0, 4)]);
  assert.equal(framed.min.x, -3);
  assert.equal(framed.max.x, 13);
});

test("small sets are framed whole, empty boxes ignored", () => {
  const framed = framingBox([box(0, 0, 0), box(500, 0, 0), new THREE.Box3()]);
  assert.deepEqual(framed.min.toArray(), [0, 0, 0]);
  assert.deepEqual(framed.max.toArray(), [501, 1, 1]);
  assert.ok(framingBox([]).isEmpty());
});
