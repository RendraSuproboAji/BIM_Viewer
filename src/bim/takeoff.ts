import type { ElementRecord } from "../../shared/api";
import { prettyCategory } from "./format";

/**
 * Quantity takeoff and colour-by-property over extracted element data.
 * Pure functions (no viewer state), so they are unit-tested directly.
 */

/** Built-in groupings; any "Pset.Property" field can be used as well. */
export const BUILTIN_FIELDS = ["Class", "Storey", "Type", "Name"] as const;
export type FieldKey = (typeof BUILTIN_FIELDS)[number] | `prop:${string}`;

export interface FieldInfo {
  key: FieldKey;
  label: string;
  /** Elements that have a value for the field. */
  count: number;
  /** True when every value is a number (summable). */
  numeric: boolean;
}

const NUMBER = /^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i;
const SEPARATOR = "␟"; // unlikely to appear in names

export const propKey = (set: string, prop: string): FieldKey => `prop:${set}${SEPARATOR}${prop}`;
export function fieldLabel(key: FieldKey) {
  if (!key.startsWith("prop:")) return key;
  const [set, prop] = key.slice(5).split(SEPARATOR);
  return `${set} › ${prop}`;
}

function typeName(e: ElementRecord) {
  const t = Object.keys(e.properties).find((k) => k.startsWith("Type: "));
  return t ? t.slice(6) : null;
}

/** The value of a field for an element (null when missing). */
export function valueOf(e: ElementRecord, key: FieldKey): string | null {
  switch (key) {
    case "Class":
      return prettyCategory(e.category) || null;
    case "Storey":
      return e.storey;
    case "Type":
      return typeName(e);
    case "Name":
      return e.name;
    default: {
      const [set, prop] = key.slice(5).split(SEPARATOR);
      const v = e.properties[set]?.[prop];
      return v === undefined || v === "" ? null : v;
    }
  }
}

export function numberOf(e: ElementRecord, key: FieldKey): number | null {
  const v = valueOf(e, key);
  return v != null && NUMBER.test(v.trim()) ? Number(v) : null;
}

/** All fields present in the data, most common first. */
export function listFields(elements: ElementRecord[]): FieldInfo[] {
  const stats = new Map<FieldKey, { count: number; numeric: boolean }>();
  const note = (key: FieldKey, value: string | null) => {
    if (value == null) return;
    const s = stats.get(key) ?? { count: 0, numeric: true };
    s.count++;
    if (!NUMBER.test(value.trim())) s.numeric = false;
    stats.set(key, s);
  };
  for (const e of elements) {
    for (const f of BUILTIN_FIELDS) note(f, valueOf(e, f));
    for (const [set, props] of Object.entries(e.properties)) {
      if (set.startsWith("Type: ")) continue;
      for (const [prop, value] of Object.entries(props)) note(propKey(set, prop), value);
    }
  }
  return [...stats.entries()]
    .map(([key, s]) => ({ key, label: fieldLabel(key), count: s.count, numeric: s.numeric && !BUILTIN_FIELDS.includes(key as never) }))
    .sort((a, b) => Number(BUILTIN_FIELDS.includes(b.key as never)) - Number(BUILTIN_FIELDS.includes(a.key as never)) || b.count - a.count || a.label.localeCompare(b.label));
}

export interface TakeoffRow {
  group: string;
  count: number;
  /** Sum per quantity field (only over elements that have a numeric value). */
  sums: Record<string, number>;
  /** Element ids per viewer model, for highlighting and geometric volume. */
  items: Record<string, number[]>;
}

export interface ModelElements {
  modelId: string;
  elements: ElementRecord[];
}

export const NO_VALUE = "(no value)";

/** Groups elements by one field and sums the chosen numeric fields per group. */
export function takeoff(models: ModelElements[], groupBy: FieldKey, quantities: FieldKey[]): TakeoffRow[] {
  const rows = new Map<string, TakeoffRow>();
  for (const { modelId, elements } of models) {
    for (const e of elements) {
      const group = valueOf(e, groupBy) ?? NO_VALUE;
      let row = rows.get(group);
      if (!row) rows.set(group, (row = { group, count: 0, sums: {}, items: {} }));
      row.count++;
      (row.items[modelId] ??= []).push(e.localId);
      for (const q of quantities) {
        const n = numberOf(e, q);
        if (n != null) row.sums[q] = (row.sums[q] ?? 0) + n;
      }
    }
  }
  return [...rows.values()].sort((a, b) => (a.group === NO_VALUE ? 1 : b.group === NO_VALUE ? -1 : a.group.localeCompare(b.group, undefined, { numeric: true })));
}

// ---- Colour by property -------------------------------------------------------------------------

/** Distinct, colour-blind-friendly categorical palette (Okabe-Ito + extras). */
export const PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999", "#8DD3C7", "#BEBADA", "#FB8072", "#80B1D3", "#FDB462", "#B3DE69"];
const OTHER_COLOR = "#5b6470";

export interface LegendEntry {
  label: string;
  color: string;
  count: number;
  items: Record<string, number[]>;
}

/**
 * Legend for colouring by a field: categorical values get palette colours (the most
 * common first, the rest grouped as "Other"); all-numeric fields get a blue→red ramp
 * over equal-width bins.
 */
export function colorLegend(models: ModelElements[], key: FieldKey, numeric: boolean, bins = 7): LegendEntry[] {
  const values: { modelId: string; localId: number; value: string | null; num: number | null }[] = [];
  for (const { modelId, elements } of models) {
    for (const e of elements) values.push({ modelId, localId: e.localId, value: valueOf(e, key), num: numeric ? numberOf(e, key) : null });
  }
  const entries = new Map<string, LegendEntry>();
  const add = (label: string, color: string, v: (typeof values)[number]) => {
    let entry = entries.get(label);
    if (!entry) entries.set(label, (entry = { label, color, count: 0, items: {} }));
    entry.count++;
    (entry.items[v.modelId] ??= []).push(v.localId);
  };

  const numbers = values.filter((v) => v.num != null).map((v) => v.num!);
  if (numeric && numbers.length) {
    let min = Infinity;
    let max = -Infinity;
    for (const n of numbers) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
    const width = (max - min) / bins || 1;
    const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Number(n.toPrecision(3)).toString());
    const labels = Array.from({ length: max === min ? 1 : bins }, (_, i) => `${fmt(min + i * width)} – ${fmt(max === min ? max : min + (i + 1) * width)}`);
    const colors = labels.map((_, i) => ramp(labels.length === 1 ? 0.5 : i / (labels.length - 1)));
    // Create in bin order so the legend reads low → high.
    labels.forEach((l, i) => entries.set(l, { label: l, color: colors[i], count: 0, items: {} }));
    for (const v of values) {
      if (v.num == null) add(NO_VALUE, OTHER_COLOR, v);
      else {
        const i = Math.min(labels.length - 1, Math.floor((v.num - min) / width));
        add(labels[i], colors[i], v);
      }
    }
    return [...entries.values()].filter((e) => e.count > 0);
  }

  const counts = new Map<string, number>();
  for (const v of values) if (v.value != null) counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
  const colorOf = new Map(ranked.slice(0, PALETTE.length).map(([value], i) => [value, PALETTE[i]]));
  for (const v of values) {
    if (v.value == null) add(NO_VALUE, OTHER_COLOR, v);
    else if (colorOf.has(v.value)) add(v.value, colorOf.get(v.value)!, v);
    else add("Other", OTHER_COLOR, v);
  }
  const order = (label: string) => (label === NO_VALUE ? 2 : label === "Other" ? 1 : 0);
  // Stable order (count, then label) so colours don't shuffle between runs.
  return [...entries.values()].sort((a, b) => order(a.label) - order(b.label) || b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Blue (low) → red (high) via green/yellow. */
function ramp(t: number) {
  const stops = [
    [0.19, 0.44, 0.79],
    [0.2, 0.7, 0.6],
    [0.95, 0.85, 0.3],
    [0.85, 0.25, 0.2],
  ];
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const c = stops[i].map((a, k) => a + (stops[i + 1][k] - a) * f);
  return `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}
