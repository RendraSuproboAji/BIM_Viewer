import assert from "node:assert/strict";
import { test } from "node:test";
import { angleAt, deltas, distance, formatLength, formatMeasurement, polygonArea, polylineLength } from "./measure.ts";

test("distance and axis deltas", () => {
  assert.equal(distance([0, 0, 0], [3, 4, 0]), 5);
  // Viewer is Y-up: plan X/Y come from x/z, height from y.
  assert.deepEqual(deltas([0, 0, 0], [1, 2, 3]), { dx: 1, dy: 3, dz: 2 });
});

test("area of planar polygons in any orientation", () => {
  const square: [number, number, number][] = [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]];
  assert.equal(polygonArea(square), 4);
  // Same square standing vertically, and in reverse winding.
  assert.equal(polygonArea([[0, 0, 0], [0, 2, 0], [0, 2, 2], [0, 0, 2]]), 4);
  assert.equal(polygonArea([...square].reverse()), 4);
  // L-shape (concave): 3x3 minus 2x2 = 5.
  assert.equal(polygonArea([[0, 0, 0], [3, 0, 0], [3, 0, 1], [1, 0, 1], [1, 0, 3], [0, 0, 3]]), 5);
  assert.equal(polygonArea([[0, 0, 0], [1, 0, 0]]), 0);
  assert.equal(polylineLength(square, true), 8);
});

test("angles", () => {
  assert.equal(angleAt([1, 0, 0], [0, 0, 0], [0, 0, 1]), 90);
  assert.ok(Math.abs(angleAt([1, 0, 0], [0, 0, 0], [1, 1, 0]) - 45) < 1e-9);
  assert.equal(angleAt([0, 0, 0], [0, 0, 0], [1, 0, 0]), 0);
});

test("formatting", () => {
  assert.equal(formatLength(0.25), "250 mm");
  assert.equal(formatLength(12.3456), "12.346 m");
  assert.equal(formatMeasurement({ kind: "angle", points: [[1, 0, 0], [0, 0, 0], [0, 0, 1]] }), "90.0°");
  assert.equal(formatMeasurement({ kind: "area", points: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]] }), "4.00 m²");
});
