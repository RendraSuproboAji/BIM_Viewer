import * as WEBIFC from "web-ifc";

/**
 * IFC class catalogue derived from web-ifc's schema inheritance tables
 * (IFC2X3, IFC4 and IFC4X3), so every physical class of every schema is known
 * without maintaining a hand-written list.
 */

const idToName = new Map<number, string>();
const nameToId = new Map<string, number>();
for (const [key, value] of Object.entries(WEBIFC)) {
  if (typeof value === "number" && /^IFC[A-Z0-9]+$/.test(key)) {
    idToName.set(value, key);
    nameToId.set(key, value);
  }
}

// InheritanceDef[schema][typeId] = every (transitive) subtype of typeId in that schema.
const inheritance = Object.values(WEBIFC.InheritanceDef as Record<string, Record<number, number[]>>);

function subtypeIds(ancestor: string) {
  const id = nameToId.get(ancestor);
  const out = new Set<number>();
  if (id === undefined) return out;
  out.add(id);
  for (const schema of inheritance) for (const sub of schema[id] ?? []) out.add(sub);
  return out;
}

function subtypeNames(...ancestors: string[]) {
  const out = new Set<string>();
  for (const a of ancestors) {
    for (const id of subtypeIds(a)) {
      const name = idToName.get(id);
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * Product classes deliberately left out of geometry import:
 * - alignments: That Open imports these as data and builds their curves itself;
 * - structural analysis items: analytical model (loads, reactions, idealised members), not physical objects.
 */
const EXCLUDED = subtypeNames("IFCALIGNMENT", "IFCALIGNMENTSEGMENT", "IFCSTRUCTURALITEM", "IFCSTRUCTURALACTIVITY");
for (const name of ["IFCALIGNMENTCANT", "IFCALIGNMENTHORIZONTAL", "IFCALIGNMENTVERTICAL"]) EXCLUDED.add(name);

/** Every IfcProduct subtype (architecture, structure, MEP, infrastructure, spatial...). */
export const ALL_PRODUCT_CLASSES = [...subtypeIds("IFCPRODUCT")].filter((id) => !EXCLUDED.has(idToName.get(id) ?? ""));

/** Every IfcTypeObject subtype (wall types, door styles, pump types...). */
export const ALL_TYPE_CLASSES = [...subtypeIds("IFCTYPEOBJECT")];

export type Discipline = "Architecture" | "Structure" | "MEP" | "Spaces & zones" | "Openings" | "Infrastructure" | "Other";

export const DISCIPLINES: Discipline[] = ["Architecture", "Structure", "MEP", "Spaces & zones", "Openings", "Infrastructure", "Other"];

const OPENINGS = subtypeNames("IFCFEATUREELEMENTSUBTRACTION");
const SPATIAL = subtypeNames("IFCSPATIALELEMENT", "IFCSPATIALSTRUCTUREELEMENT");
const MEP = subtypeNames(
  "IFCDISTRIBUTIONELEMENT", // IFC4+: flow segments/fittings/terminals, controls, chambers...
  "IFCDISTRIBUTIONPORT",
  "IFCELECTRICALELEMENT", // IFC2X3
  "IFCEQUIPMENTELEMENT", // IFC2X3
);
const STRUCTURE = subtypeNames(
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCMEMBER",
  "IFCPLATE",
  "IFCFOOTING",
  "IFCPILE",
  "IFCDEEPFOUNDATION",
  "IFCBEARING",
  "IFCREINFORCINGELEMENT",
  "IFCTENDONCONDUIT",
  "IFCFASTENER",
  "IFCMECHANICALFASTENER",
  "IFCDISCRETEACCESSORY",
  "IFCVIBRATIONDAMPER",
  "IFCVIBRATIONISOLATOR",
);
const INFRASTRUCTURE = subtypeNames(
  "IFCCIVILELEMENT",
  "IFCGEOGRAPHICELEMENT",
  "IFCGEOTECHNICALELEMENT",
  "IFCEARTHWORKSELEMENT",
  "IFCCOURSE",
  "IFCPAVEMENT",
  "IFCKERB",
  "IFCRAIL",
  "IFCTRACKELEMENT",
  "IFCSIGN",
  "IFCSIGNAL",
  "IFCNAVIGATIONELEMENT",
  "IFCMOORINGDEVICE",
  "IFCIMPACTPROTECTIONDEVICE",
  "IFCREINFORCEDSOIL",
  "IFCTRANSPORTATIONDEVICE",
  "IFCLINEARELEMENT",
  "IFCPOSITIONINGELEMENT",
);
const ARCHITECTURE = subtypeNames(
  "IFCBUILDINGELEMENT", // IFC2X3 / IFC4
  "IFCBUILTELEMENT", // IFC4X3
  "IFCFURNISHINGELEMENT",
  "IFCTRANSPORTELEMENT",
  "IFCFEATUREELEMENTADDITION",
);

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

/**
 * Non-geometric classes imported as data on top of That Open's defaults
 * (which only keep IfcPropertySingleValue and simple quantities).
 */
export const EXTRA_DATA_CLASSES = [
  ...subtypeIds("IFCTYPEOBJECT"), // wall/door/pump types, IFC2X3 door & window styles
  ...subtypeIds("IFCPROPERTY"), // enumerated, bounded, list, table, reference and complex properties
  ...subtypeIds("IFCPROPERTYENUMERATION"),
  ...subtypeIds("IFCPROPERTYSETDEFINITION"), // property sets, quantity sets, door/window lining & panel properties
  ...subtypeIds("IFCPHYSICALQUANTITY"),
  ...subtypeIds("IFCGROUP"), // MEP systems (IfcSystem, IfcDistributionSystem, IfcDistributionCircuit), zones
  ...subtypeIds("IFCCLASSIFICATION"),
  ...subtypeIds("IFCCLASSIFICATIONREFERENCE"),
];

/**
 * Relations imported on top of That Open's defaults, as
 * [relation, inverse attribute on the relating entity, inverse attribute on the related entity].
 */
export const EXTRA_RELATIONS: [number, string, string][] = [
  // MEP
  [WEBIFC.IFCRELASSIGNSTOGROUP, "IsGroupedBy", "HasAssignments"],
  [WEBIFC.IFCRELSERVICESBUILDINGS, "ServicesBuildings", "ServicedBySystems"],
  [WEBIFC.IFCRELCONNECTSPORTTOELEMENT, "ContainedIn", "HasPorts"],
  [WEBIFC.IFCRELCONNECTSPORTS, "ConnectedTo", "ConnectedFrom"],
  [WEBIFC.IFCRELFLOWCONTROLELEMENTS, "HasControlElements", "AssignedToFlowElement"],
  // Architecture
  [WEBIFC.IFCRELVOIDSELEMENT, "HasOpenings", "VoidsElements"],
  [WEBIFC.IFCRELFILLSELEMENT, "HasFillings", "FillsVoids"],
  [WEBIFC.IFCRELPROJECTSELEMENT, "HasProjections", "ProjectsElements"],
  [WEBIFC.IFCRELCOVERSBLDGELEMENTS, "HasCoverings", "CoversElements"],
  [WEBIFC.IFCRELCOVERSSPACES, "HasCoverings", "CoversSpaces"],
  [WEBIFC.IFCRELSPACEBOUNDARY, "BoundedBy", "ProvidesBoundaries"],
  [WEBIFC.IFCRELCONNECTSPATHELEMENTS, "ConnectedTo", "ConnectedFrom"],
  // Classification systems (Uniclass, OmniClass...)
  [WEBIFC.IFCRELASSOCIATESCLASSIFICATION, "ClassificationRefForObjects", "HasAssociations"],
];
