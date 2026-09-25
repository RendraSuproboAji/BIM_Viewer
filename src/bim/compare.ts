import * as THREE from "three";
import type { ElementRecord } from "../../shared/api";

/**
 * Compares two versions of a model by IFC GlobalId: elements added, removed,
 * or changed (name, class, storey, any property, or geometry).
 */

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ChangedElement {
  guid: string;
  before: ElementRecord;
  after: ElementRecord;
  changes: FieldChange[];
}

export interface ModelDiff {
  added: ElementRecord[];
  removed: ElementRecord[];
  changed: ChangedElement[];
  unchanged: number;
  /** Elements without a GlobalId can't be matched and are left out. */
  unmatched: number;
}

export type BoxesByGuid = Map<string, THREE.Box3>;

const fmt = (v: THREE.Vector3) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

/** Geometry change from bounding boxes: moved (centre) and/or resized (size), beyond `tolerance` metres. */
function geometryChanges(a: THREE.Box3 | undefined, b: THREE.Box3 | undefined, tolerance: number): FieldChange[] {
  if (!a || !b || a.isEmpty() || b.isEmpty()) return [];
  const out: FieldChange[] = [];
  const ca = a.getCenter(new THREE.Vector3());
  const cb = b.getCenter(new THREE.Vector3());
  const sa = a.getSize(new THREE.Vector3());
  const sb = b.getSize(new THREE.Vector3());
  if (ca.distanceTo(cb) > tolerance) {
    out.push({ field: "Geometry › Position", before: fmt(ca), after: `${fmt(cb)} (moved ${(ca.distanceTo(cb) * 1000).toFixed(0)} mm)` });
  }
  if (Math.max(Math.abs(sa.x - sb.x), Math.abs(sa.y - sb.y), Math.abs(sa.z - sb.z)) > tolerance) {
    out.push({ field: "Geometry › Size", before: fmt(sa), after: fmt(sb) });
  }
  return out;
}

function propertyChanges(a: ElementRecord, b: ElementRecord): FieldChange[] {
  const out: FieldChange[] = [];
  const compare = (field: string, before: string | null | undefined, after: string | null | undefined) => {
    if ((before ?? null) !== (after ?? null)) out.push({ field, before: before ?? null, after: after ?? null });
  };
  compare("Name", a.name, b.name);
  compare("Class", a.category, b.category);
  compare("Storey", a.storey, b.storey);
  const sets = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
  for (const set of [...sets].sort()) {
    const pa = a.properties[set] ?? {};
    const pb = b.properties[set] ?? {};
    for (const prop of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort()) compare(`${set} › ${prop}`, pa[prop], pb[prop]);
  }
  return out;
}

export function diffModels(
  before: ElementRecord[],
  after: ElementRecord[],
  boxes: { before: BoxesByGuid; after: BoxesByGuid },
  tolerance = 0.001,
): ModelDiff {
  const byGuid = (list: ElementRecord[]) => {
    const map = new Map<string, ElementRecord>();
    for (const e of list) if (e.guid) map.set(e.guid, e);
    return map;
  };
  const a = byGuid(before);
  const b = byGuid(after);
  const diff: ModelDiff = {
    added: [],
    removed: [],
    changed: [],
    unchanged: 0,
    unmatched: before.filter((e) => !e.guid).length + after.filter((e) => !e.guid).length,
  };
  for (const [guid, e] of b) if (!a.has(guid)) diff.added.push(e);
  for (const [guid, e] of a) if (!b.has(guid)) diff.removed.push(e);
  for (const [guid, eb] of b) {
    const ea = a.get(guid);
    if (!ea) continue;
    const changes = [...propertyChanges(ea, eb), ...geometryChanges(boxes.before.get(guid), boxes.after.get(guid), tolerance)];
    if (changes.length) diff.changed.push({ guid, before: ea, after: eb, changes });
    else diff.unchanged++;
  }
  const byName = (x: ElementRecord, y: ElementRecord) => x.category.localeCompare(y.category) || (x.name ?? "").localeCompare(y.name ?? "");
  diff.added.sort(byName);
  diff.removed.sort(byName);
  diff.changed.sort((x, y) => byName(x.after, y.after));
  return diff;
}
