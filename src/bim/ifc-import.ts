import type * as FRAGS from "@thatopen/fragments";
import { ALL_PRODUCT_CLASSES, EXTRA_DATA_CLASSES, EXTRA_RELATIONS } from "./ifc-classes";

/**
 * That Open only converts a curated subset of IFC classes by default, which
 * silently drops e.g. IfcDistributionBoard, IfcLiquidTerminal, IfcSpatialZone,
 * IFC2X3 IfcElectricalElement, and non-single-value properties. Widen the
 * importer to every physical class of every schema plus the data MEP and
 * architecture workflows need (systems, openings/fillings, classifications).
 */
export function includeEverything(importer: FRAGS.IfcImporter) {
  for (const id of ALL_PRODUCT_CLASSES) importer.classes.elements.add(id);
  for (const id of EXTRA_DATA_CLASSES) {
    if (!importer.classes.elements.has(id)) importer.classes.abstract.add(id);
  }
  for (const [rel, forRelating, forRelated] of EXTRA_RELATIONS) {
    importer.relations.set(rel, { forRelating, forRelated });
  }
}

/** Messages exchanged with ifc-worker.ts. */
export type IfcWorkerRequest = { bytes: Uint8Array; wasmPath: string };
export type IfcWorkerResponse =
  | { type: "progress"; progress: number }
  | { type: "done"; bytes: Uint8Array }
  | { type: "error"; message: string };
