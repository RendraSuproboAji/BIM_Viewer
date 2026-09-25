import type { ElementRecord } from "../../shared/api.ts";
import { csvDocument } from "../../shared/csv.ts";

export { csvCell, csvDocument } from "../../shared/csv.ts";

export function safeFileName(name: string) {
  return name.replace(/\.(ifc|frag)$/i, "").replace(/[^\w.-]+/g, "_") || "model";
}

/** One row per element; property columns are "Pset.Property", unioned over all elements. */
export function toCsv(elements: ElementRecord[]) {
  const columns = new Map<string, [string, string]>();
  for (const e of elements) {
    for (const [set, props] of Object.entries(e.properties)) {
      for (const prop of Object.keys(props)) columns.set(JSON.stringify([set, prop]), [set, prop]);
    }
  }
  const sorted = [...columns.values()].sort((a, b) => `${a[0]}.${a[1]}`.localeCompare(`${b[0]}.${b[1]}`));
  const header = ["LocalId", "GlobalId", "Class", "Name", "Storey", ...sorted.map(([set, prop]) => `${set}.${prop}`)];
  const rows = elements.map((e) => [e.localId, e.guid ?? "", e.category, e.name ?? "", e.storey ?? "", ...sorted.map(([set, prop]) => e.properties[set]?.[prop] ?? "")]);
  return csvDocument([header, ...rows]);
}

