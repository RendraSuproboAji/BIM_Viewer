import * as TABLES from "./ifc-disciplines.generated";

/**
 * IFC disciplines for the viewer. The class tables are generated from web-ifc's
 * schemas (see ifc-schema.ts), so the multi-MB web-ifc module stays out of the
 * main bundle.
 */

export type Discipline = "Architecture" | "Structure" | "MEP" | "Spaces & zones" | "Openings" | "Infrastructure" | "Other";

export const DISCIPLINES: Discipline[] = ["Architecture", "Structure", "MEP", "Spaces & zones", "Openings", "Infrastructure", "Other"];

const OPENINGS = new Set(TABLES.OPENINGS);
const SPATIAL = new Set(TABLES.SPATIAL);
const MEP = new Set(TABLES.MEP);
const STRUCTURE = new Set(TABLES.STRUCTURE);
const ARCHITECTURE = new Set(TABLES.ARCHITECTURE);
const INFRASTRUCTURE = new Set(TABLES.INFRASTRUCTURE);

export function disciplineOf(category: string): Discipline {
  const c = category.toUpperCase();
  if (OPENINGS.has(c)) return "Openings";
  if (SPATIAL.has(c)) return "Spaces & zones";
  if (MEP.has(c)) return "MEP";
  if (STRUCTURE.has(c)) return "Structure";
  // Checked before infrastructure: IfcTransportElement (lifts, escalators) is an
  // IfcTransportationDevice in IFC4X3 but belongs with the building.
  if (ARCHITECTURE.has(c)) return "Architecture";
  if (INFRASTRUCTURE.has(c)) return "Infrastructure";
  return "Other";
}

/** Classes hidden right after loading because they would otherwise cover the building. */
export const HIDDEN_BY_DEFAULT = new Set([...OPENINGS, "IFCSPACE", "IFCSPATIALZONE", "IFCEXTERNALSPATIALELEMENT"]);
