import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { candidatePairs, detectClashes, type ClashItem } from "./clash.ts";

/** Axis-aligned box mesh in world space. */
function boxAt(key: string, center: [number, number, number], size: [number, number, number]) {
  const geometry = new THREE.BoxGeometry(...size).translate(...center);
  geometry.computeBoundingBox();
  return { key, box: geometry.boundingBox!.clone(), geometry };
}
/** Cylinder (pipe) along X. */
function pipe(key: string, y: number, z: number, radius: number, from = -1, to = 5) {
  const geometry = new THREE.CylinderGeometry(radius, radius, to - from, 24).rotateZ(Math.PI / 2).translate((from + to) / 2, y, z);
  geometry.computeBoundingBox();
  return { key, box: geometry.boundingBox!.clone(), geometry };
}

type Item = ClashItem & { geometry: THREE.BufferGeometry };
const run = (a: Item[], b: Item[], mode: "hard" | "clearance", tolerance: number) =>
  detectClashes(a, b, async (i) => i.geometry, { mode, tolerance }).then((r) => r.map((c) => `${c.a.key}-${c.b.key}`).sort());

const wall = boxAt("wall", [2, 1.25, 1.5], [4, 2.5, 3]);
const slab = boxAt("slab", [2, -0.1, 1.5], [4, 0.2, 3]); // touches the wall's underside
const through = pipe("through", 1.2, 1.5, 0.1); // passes through the wall
const near = pipe("near", 1.2, 3.05, 0.02); // 3 cm from the wall face (z = 3)
const far = pipe("far", 1.2, 6, 0.1);
// Diagonal pipe from (3.5, 1.2, 4) to (5, 1.2, 2.5): its box overlaps the wall's box around the
// corner (4, y, 3), but the pipe passes 0.35 m outside that corner, so the meshes don't touch.
const diagonal = (() => {
  const geometry = new THREE.CylinderGeometry(0.05, 0.05, Math.hypot(1.5, 1.5), 16).rotateX(Math.PI / 2).rotateY((3 * Math.PI) / 4).translate(4.25, 1.2, 3.25);
  geometry.computeBoundingBox();
  return { key: "diagonal", box: geometry.boundingBox!.clone(), geometry };
})();

test("broad phase finds overlapping boxes only, once per pair", () => {
  const pairs = candidatePairs([wall, slab], [through, near, far, diagonal]);
  assert.deepEqual(pairs.map(([a, b]) => `${a.key}-${b.key}`).sort(), ["wall-diagonal", "wall-through"]);
  // Growing the boxes by a clearance margin brings in the pipe 3 cm from the wall.
  assert.ok(candidatePairs([wall], [near], 0.05).length === 1 && candidatePairs([wall], [near], 0).length === 0);
  // An element in both sets pairs with others once and never with itself.
  const both = candidatePairs([wall, through], [wall, through]);
  assert.deepEqual(both.map(([a, b]) => [a.key, b.key].sort().join("-")), ["through-wall"]);
});

test("hard clashes: intersecting meshes only; touching and box-only overlaps are ignored", async () => {
  assert.deepEqual(await run([wall, slab], [through, near, far, diagonal], "hard", 0.001), ["wall-through"]);
  // Touching faces aren't clashes even at zero tolerance on the overlap depth.
  assert.deepEqual(await run([slab], [wall], "hard", 0.001), []);
});

test("clearance: reports elements closer than the distance, with the distance", async () => {
  const within5cm = await detectClashes([wall], [through, near, far], async (i) => (i as Item).geometry, { mode: "clearance", tolerance: 0.05 });
  const byKey = Object.fromEntries(within5cm.map((c) => [c.b.key, c.distance]));
  assert.deepEqual(Object.keys(byKey).sort(), ["near", "through"]);
  assert.equal(byKey.through, 0);
  assert.ok(Math.abs(byKey.near - 0.03) < 0.002, `near distance ${byKey.near}`);
  assert.deepEqual(await run([wall], [through, near, far], "clearance", 0.01), ["wall-through"]);
});

test("clash point lies inside both boxes", async () => {
  const [clash] = await detectClashes([wall], [through], async (i) => (i as Item).geometry, { mode: "hard", tolerance: 0.001 });
  const p = new THREE.Vector3(...clash.point);
  assert.ok(wall.box.containsPoint(p) && through.box.containsPoint(p));
});
