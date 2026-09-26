import assert from "node:assert/strict";
import { test } from "node:test";
import { colorByWithout, useViewer } from "./store";
import type { ColorByState } from "./colorby";

const colorBy: ColorByState = {
  key: "Class",
  label: "Class",
  numeric: false,
  legend: [
    { label: "IFCWALL", color: "#f00", count: 5, items: { a: [1, 2, 3], b: [7, 8] } },
    { label: "IFCDOOR", color: "#0f0", count: 1, items: { b: [9] } },
  ],
  hidden: ["IFCDOOR"],
};

test("closing a model removes its elements from the colour legend", () => {
  const next = colorByWithout(colorBy, "b")!;
  assert.deepEqual(next.legend, [{ label: "IFCWALL", color: "#f00", count: 3, items: { a: [1, 2, 3] } }]);
  assert.deepEqual(next.hidden, [], "a legend entry that disappeared can't stay hidden");
  assert.equal(colorByWithout(next, "a"), null, "nothing left: colour-by ends");
});

test("removing a model drops clash results and comparisons that refer to it", () => {
  const element = (modelId: string) => ({ modelId, localId: 1 }) as never;
  useViewer.setState({
    models: [
      { id: "a", name: "a", visible: true },
      { id: "b", name: "b", visible: true },
      { id: "c", name: "c", visible: true },
    ],
    clashRun: { results: [{ a: element("a"), b: element("b") }] } as never,
    compareRun: { beforeId: "a", afterId: "c" } as never,
    colorBy,
  });
  useViewer.getState().removeModel("c");
  assert.ok(useViewer.getState().clashRun, "the clash run doesn't involve c");
  assert.equal(useViewer.getState().compareRun, null);
  useViewer.getState().removeModel("b");
  assert.equal(useViewer.getState().clashRun, null);
  assert.deepEqual(useViewer.getState().colorBy?.legend.map((e) => e.label), ["IFCWALL"]);
});
