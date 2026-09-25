import type { ItemAttribute, ItemData } from "@thatopen/fragments";
import { useEffect, useState } from "react";
import { engine } from "../bim/engine";
import { useViewer } from "../bim/store";

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
          IsDefinedBy: { attributes: true, relations: true },
          DefinesOcurrence: { attributes: false, relations: false },
          HasAssociations: { attributes: true, relations: false },
          ContainedInStructure: { attributes: true, relations: false },
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

function format(v: unknown) {
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
  const groups: PropertyGroup[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (isAttr(value)) {
      attributes.push([key.replace(/^_/, ""), format(value.value)]);
      continue;
    }
    if (!Array.isArray(value)) continue;

    if (key === "IsDefinedBy") {
      for (const set of value) {
        const group = propertySet(set);
        if (group.rows.length) groups.push(group);
      }
    } else {
      const rows: [string, string][] = value.map((rel) => [
        format(attrValue(rel, "_category")) || key,
        format(attrValue(rel, "Name") ?? attrValue(rel, "_localId")),
      ]);
      if (rows.length) groups.push({ title: key.replace(/([a-z])([A-Z])/g, "$1 $2"), rows });
    }
  }

  return [{ title: "Attributes", rows: attributes }, ...groups];
}

/** Handles both IfcPropertySet (HasProperties) and IfcElementQuantity (Quantities). */
function propertySet(set: ItemData): PropertyGroup {
  const title = format(attrValue(set, "Name")) || "Property set";
  const rows: [string, string][] = [];
  // Only follow the property lists; other arrays are back-references (e.g. to the element).
  for (const key of ["HasProperties", "Quantities"]) {
    const value = set[key];
    if (!Array.isArray(value)) continue;
    for (const prop of value) {
      const name = format(attrValue(prop, "Name"));
      const valueKey = Object.keys(prop).find((k) => /Value$/.test(k) && isAttr(prop[k]));
      rows.push([name, valueKey ? format(attrValue(prop, valueKey)) : ""]);
    }
  }
  return { title, rows };
}
