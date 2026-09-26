import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { render } from "../../scripts/gen-ifc-classes";
import { disciplineOf, HIDDEN_BY_DEFAULT } from "./ifc-classes";

test("the generated discipline tables match web-ifc (run `npm run gen:ifc-classes` after upgrading it)", () => {
  const current = fs.readFileSync(new URL("./ifc-disciplines.generated.ts", import.meta.url), "utf8");
  assert.equal(current, render());
});

test("classes map to their discipline in every schema", () => {
  assert.equal(disciplineOf("IFCWALL"), "Architecture");
  assert.equal(disciplineOf("IfcWallStandardCase"), "Architecture"); // IFC2X3/IFC4
  assert.equal(disciplineOf("IFCBEAM"), "Structure");
  assert.equal(disciplineOf("IFCDUCTSEGMENT"), "MEP");
  assert.equal(disciplineOf("IFCELECTRICALELEMENT"), "MEP"); // IFC2X3
  assert.equal(disciplineOf("IFCSPACE"), "Spaces & zones");
  assert.equal(disciplineOf("IFCOPENINGELEMENT"), "Openings");
  assert.equal(disciplineOf("IFCTRANSPORTELEMENT"), "Architecture");
  assert.equal(disciplineOf("IFCGEOGRAPHICELEMENT"), "Infrastructure");
  assert.equal(disciplineOf("IFCANNOTATION"), "Other");
  assert.ok(HIDDEN_BY_DEFAULT.has("IFCOPENINGELEMENT") && HIDDEN_BY_DEFAULT.has("IFCSPACE") && !HIDDEN_BY_DEFAULT.has("IFCWALL"));
});
