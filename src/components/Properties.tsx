import type { ItemAttribute, ItemData } from "@thatopen/fragments";
import { useEffect, useState } from "react";
import { engine } from "../bim/engine";
import { useViewer } from "../bim/store";

/** Relations shown as their own groups, in display order. */
const RELATION_LABELS: Record<string, string> = {
  ContainedInStructure: "Contained in",
  Decomposes: "Part of",
  IsDecomposedBy: "Parts",
  HasAssignments: "Systems & groups",
  ServicedBySystems: "Serviced by systems",
  HasAssociations: "Materials & classifications",
  FillsVoids: "Fills opening",
  HasFillings: "Filled by",
  VoidsElements: "Voids element",
  HasOpenings: "Openings",
  HasCoverings: "Coverings",
  HasPorts: "Ports",
};

interface PropertyGroup {
  title: string;
  rows: [string, string][];
}

export function Properties() {
  const selection = useViewer((s) => s.selection);
  const [groups, setGroups] = useState<PropertyGroup[] | null>(null);

  useEffect(() => {
    setGroups(null);
    if (!selection) return;
    let cancelled = false;
    const model = engine.getModel(selection.modelId);
    model
      ?.getItemsData([selection.localId], {
        attributesDefault: true,
        relations: {
          // Unlisted relations inherit their parent's config in getItemsData, so
          // every branch below IsDefinedBy is spelled out to keep traversal bounded.
          IsDefinedBy: { attributes: true, relations: true },
          HasPropertySets: { attributes: true, relations: true }, // property sets of the type object
          HasProperties: { attributes: true, relations: true }, // incl. nested IfcComplexProperty
          HasQuantities: { attributes: true, relations: true },
          Quantities: { attributes: true, relations: true },
          // Back-references: following them would load every element sharing the pset/type.
          DefinesOccurrence: { attributes: false, relations: false },
          ObjectTypeOf: { attributes: false, relations: false },
          Types: { attributes: false, relations: false },
          ...Object.fromEntries(Object.keys(RELATION_LABELS).map((r) => [r, { attributes: true, relations: false }])),
        },
      })
      .then(([data]) => !cancelled && setGroups(data ? toGroups(data) : []));
    return () => {
      cancelled = true;
    };
  }, [selection]);

  if (!selection) return <p className="empty">Click an element in the viewer or the tree to see its properties.</p>;
  if (!groups) return <p className="empty">Loading properties…</p>;

  return (
    <div className="props">
      {groups.map((g, i) => (
        <details key={i} open={i < 2}>
          <summary>{g.title}</summary>
          <table>
            <tbody>
              {g.rows.map(([k, v], j) => (
                <tr key={j}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

const isAttr = (v: unknown): v is ItemAttribute => !!v && typeof v === "object" && !Array.isArray(v) && "value" in v;

function format(v: unknown): string {
  if (Array.isArray(v)) return v.map(format).join(", ");
  if (v && typeof v === "object" && "value" in v) return format((v as { value: unknown }).value);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return v == null ? "" : String(v);
}

function attrValue(item: ItemData, key: string) {
  const a = item[key];
  return isAttr(a) ? a.value : undefined;
}

/** Converts raw ItemData (attributes + relations) into display groups. */
function toGroups(data: ItemData): PropertyGroup[] {
  const attributes: [string, string][] = [];
  const typeGroups: PropertyGroup[] = [];
  const psets: PropertyGroup[] = [];
  const relations: PropertyGroup[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (isAttr(value)) {
      attributes.push([key.replace(/^_/, ""), format(value.value)]);
      continue;
    }
    if (!Array.isArray(value)) continue;

    if (key === "IsDefinedBy") {
      for (const def of value) {
        const category = String(attrValue(def, "_category") ?? "");
        if (/(TYPE|STYLE)$/i.test(category)) {
          // IfcRelDefinesByType: the element's type object (IfcWallType, IFC2X3 IfcDoorStyle...).
          const typeName = format(attrValue(def, "Name")) || category;
          typeGroups.push({ title: `Type: ${typeName}`, rows: [["Class", category], ...attributeRows(def)] });
          const typeSets = def.HasPropertySets;
          if (Array.isArray(typeSets)) {
            for (const set of typeSets) {
              const group = propertySet(set);
              if (group.rows.length) typeGroups.push({ ...group, title: `${group.title} (type)` });
            }
          }
          continue;
        }
        const group = propertySet(def);
        if (group.rows.length) psets.push(group);
      }
    } else if (key in RELATION_LABELS) {
      const rows: [string, string][] = value.map((rel) => [format(attrValue(rel, "_category")) || key, label(rel)]);
      if (rows.length) relations.push({ title: RELATION_LABELS[key], rows });
    }
  }

  const order = Object.values(RELATION_LABELS);
  relations.sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title));
  return [{ title: "Attributes", rows: attributes }, ...typeGroups, ...psets, ...relations];
}

/** Best human label for a related entity (materials, systems, classification references...). */
function label(item: ItemData) {
  const code = attrValue(item, "Identification") ?? attrValue(item, "ItemReference");
  const name = attrValue(item, "Name");
  if (/CLASSIFICATIONREFERENCE$/i.test(String(attrValue(item, "_category") ?? "")) && code && name) {
    return `${format(code)} · ${format(name)}`;
  }
  for (const key of ["Name", "LongName", "Identification", "ItemReference", "Description"]) {
    const v = attrValue(item, key);
    if (v != null && v !== "") return format(v);
  }
  return `#${format(attrValue(item, "_localId"))}`;
}

function attributeRows(item: ItemData): [string, string][] {
  return Object.entries(item)
    .filter(([k, v]) => isAttr(v) && !k.startsWith("_") && k !== "Name" && v.value != null && v.value !== "")
    .map(([k, v]) => [k, format((v as ItemAttribute).value)]);
}

/** Handles both IfcPropertySet (HasProperties) and IfcElementQuantity (Quantities). */
function propertySet(set: ItemData): PropertyGroup {
  const title = format(attrValue(set, "Name")) || "Property set";
  const rows: [string, string][] = [];
  // Only follow the property lists; other arrays are back-references (e.g. to the element).
  for (const key of ["HasProperties", "Quantities"]) {
    const value = set[key];
    if (Array.isArray(value)) for (const prop of value) addProperty(prop, "", rows);
  }
  return { title, rows };
}

/** Flattens any IfcProperty / IfcPhysicalQuantity subtype into display rows. */
function addProperty(prop: ItemData, prefix: string, rows: [string, string][]) {
  const name = prefix + format(attrValue(prop, "Name"));
  // IfcComplexProperty / IfcPhysicalComplexQuantity nest further properties.
  const nested = prop.HasProperties ?? prop.HasQuantities;
  if (Array.isArray(nested)) {
    for (const child of nested) addProperty(child, `${name} › `, rows);
    return;
  }
  rows.push([name, propertyValue(prop)]);
}

function propertyValue(prop: ItemData) {
  const v = (key: string) => attrValue(prop, key);
  // IfcPropertyBoundedValue
  if (v("LowerBoundValue") != null || v("UpperBoundValue") != null) {
    const range = `${format(v("LowerBoundValue")) || "…"} – ${format(v("UpperBoundValue")) || "…"}`;
    return v("SetPointValue") != null ? `${range} (set point ${format(v("SetPointValue"))})` : range;
  }
  // Single/enumerated/list/reference values and quantities (LengthValue, AreaValue...)
  for (const key of ["NominalValue", "EnumerationValues", "ListValues", "PropertyReference"]) {
    if (v(key) != null) return format(v(key));
  }
  const valueKey = Object.keys(prop).find((k) => /Value$/.test(k) && isAttr(prop[k]));
  if (valueKey) return format(v(valueKey));
  // IfcPropertyTableValue
  if (v("DefiningValues") != null) return `${format(v("DefiningValues"))} → ${format(v("DefinedValues"))}`;
  return "";
}
