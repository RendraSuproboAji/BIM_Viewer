import assert from "node:assert/strict";
import { test } from "node:test";
import type { ElementRecord } from "../../shared/api.ts";
import { colorLegend, listFields, NO_VALUE, PALETTE, propKey, takeoff, valueOf } from "./takeoff.ts";

const el = (localId: number, category: string, storey: string | null, props: ElementRecord["properties"] = {}, name: string | null = null): ElementRecord => ({
  localId,
  guid: `g${localId}`,
  category,
  name,
  storey,
  properties: props,
});

const models = [
  {
    modelId: "arch",
    elements: [
      el(1, "IFCWALL", "L0", { Qto_WallBaseQuantities: { NetVolume: "2.5", Length: "4" }, "Type: Basic 200": { Class: "IFCWALLTYPE" } }),
      el(2, "IFCWALL", "L1", { Qto_WallBaseQuantities: { NetVolume: "1.5", Length: "3" }, "Type: Basic 200": { Class: "IFCWALLTYPE" } }),
      el(3, "IFCSLAB", "L0", { Qto_SlabBaseQuantities: { NetVolume: "10" }, Pset_SlabCommon: { IsExternal: "No" } }),
    ],
  },
  { modelId: "mep", elements: [el(7, "IFCPIPESEGMENT", "L0", { Pset_PipeSegmentTypeCommon: { NominalDiameter: "300" } }), el(8, "IFCPIPESEGMENT", null, {})] },
];

test("fields: built-ins first, numeric detection, type from the type group", () => {
  const fields = listFields(models.flatMap((m) => m.elements));
  // Built-in fields that have values come first (no element has a name here).
  assert.deepEqual(fields.slice(0, 3).map((f) => f.key), ["Class", "Storey", "Type"]);
  assert.ok(!fields.some((f) => f.key === "Name"));
  const volume = fields.find((f) => f.key === propKey("Qto_WallBaseQuantities", "NetVolume"))!;
  assert.equal(volume.numeric, true);
  assert.equal(volume.count, 2);
  assert.equal(fields.find((f) => f.key === propKey("Pset_SlabCommon", "IsExternal"))!.numeric, false);
  assert.equal(valueOf(models[0].elements[0], "Type"), "Basic 200");
});

test("takeoff groups, counts and sums across models", () => {
  const vol = propKey("Qto_WallBaseQuantities", "NetVolume");
  const rows = takeoff(models, "Storey", [vol]);
  assert.deepEqual(rows.map((r) => [r.group, r.count, r.sums[vol] ?? 0]), [["L0", 3, 2.5], ["L1", 1, 1.5], [NO_VALUE, 1, 0]]);
  assert.deepEqual(rows[0].items, { arch: [1, 3], mep: [7] });
  const byClass = takeoff(models, "Class", []);
  assert.deepEqual(byClass.map((r) => [r.group, r.count]), [["Pipesegment", 2], ["Slab", 1], ["Wall", 2]]);
});

test("categorical colours: most common first, missing values last", () => {
  const legend = colorLegend(models, "Class", false);
  assert.deepEqual(legend.map((l) => [l.label, l.count]), [["Pipesegment", 2], ["Wall", 2], ["Slab", 1]]);
  assert.equal(legend[0].color, PALETTE[0]);
  const byStorey = colorLegend(models, "Storey", false);
  assert.equal(byStorey.at(-1)!.label, NO_VALUE);
});

test("numeric colours: binned low → high", () => {
  const key = propKey("Qto_WallBaseQuantities", "Length");
  const legend = colorLegend(models, key, true, 2);
  assert.deepEqual(legend.map((l) => [l.label, l.count]), [["3 – 3.5", 1], ["3.5 – 4", 1], [NO_VALUE, 3]]);
  assert.notEqual(legend[0].color, legend[1].color);
  assert.deepEqual(legend[1].items, { arch: [1] });
});

test("more values than colours fall into Other", () => {
  const many = [{ modelId: "m", elements: Array.from({ length: PALETTE.length + 3 }, (_, i) => el(i, "IFCWALL", `Level ${i}`)) }];
  const legend = colorLegend(many, "Storey", false);
  assert.equal(legend.length, PALETTE.length + 1);
  assert.equal(legend.at(-1)!.label, "Other");
  assert.equal(legend.at(-1)!.count, 3);
});
