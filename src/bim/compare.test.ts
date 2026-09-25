import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import type { ElementRecord } from "../../shared/api.ts";
import { diffModels } from "./compare.ts";

const el = (guid: string | null, name: string, props: ElementRecord["properties"] = {}, storey = "L0", category = "IFCWALL"): ElementRecord => ({
  localId: Math.floor(Math.random() * 1e6),
  guid,
  category,
  name,
  storey,
  properties: props,
});
const box = (x: number, size = 1) => new THREE.Box3(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x + size, size, size));

test("added, removed, unchanged and unmatched", () => {
  const before = [el("a", "Wall A"), el("b", "Wall B"), el(null, "No guid")];
  const after = [el("a", "Wall A"), el("c", "Wall C")];
  const d = diffModels(before, after, { before: new Map([["a", box(0)]]), after: new Map([["a", box(0)]]) });
  assert.deepEqual(d.added.map((e) => e.guid), ["c"]);
  assert.deepEqual(d.removed.map((e) => e.guid), ["b"]);
  assert.equal(d.unchanged, 1);
  assert.equal(d.changed.length, 0);
  assert.equal(d.unmatched, 1);
});

test("property, name, storey and class changes", () => {
  const before = [el("a", "Wall A", { Pset_WallCommon: { FireRating: "EI30", IsExternal: "Yes" } })];
  const after = [el("a", "Wall A2", { Pset_WallCommon: { FireRating: "EI60" }, Pset_New: { Note: "x" } }, "L1", "IFCWALLSTANDARDCASE")];
  const [c] = diffModels(before, after, { before: new Map(), after: new Map() }).changed;
  assert.deepEqual(
    c.changes.map((x) => [x.field, x.before, x.after]),
    [
      ["Name", "Wall A", "Wall A2"],
      ["Class", "IFCWALL", "IFCWALLSTANDARDCASE"],
      ["Storey", "L0", "L1"],
      ["Pset_New › Note", null, "x"],
      ["Pset_WallCommon › FireRating", "EI30", "EI60"],
      ["Pset_WallCommon › IsExternal", "Yes", null],
    ],
  );
});

test("geometry: moved and resized beyond the tolerance only", () => {
  const e = [el("a", "Wall")];
  const same = diffModels(e, e, { before: new Map([["a", box(0)]]), after: new Map([["a", box(0.0005)]]) });
  assert.equal(same.changed.length, 0, "0.5 mm is within the 1 mm tolerance");
  const moved = diffModels(e, e, { before: new Map([["a", box(0)]]), after: new Map([["a", box(0.25)]]) });
  assert.deepEqual(moved.changed[0].changes.map((c) => c.field), ["Geometry › Position"]);
  assert.match(moved.changed[0].changes[0].after!, /moved 250 mm/);
  const resized = diffModels(e, e, { before: new Map([["a", box(0, 1)]]), after: new Map([["a", box(0, 1.2)]]) });
  assert.deepEqual(resized.changed[0].changes.map((c) => c.field), ["Geometry › Position", "Geometry › Size"]);
});
