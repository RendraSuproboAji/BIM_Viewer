import type { FragmentsModel } from "@thatopen/fragments";
import type { ElementRecord } from "../../shared/api";
import { engine } from "./engine";
import { PROPERTIES_QUERY, toElementRecord } from "./properties";
import type { ModelElements } from "./takeoff";

const EXTRACT_BATCH = 250;
const cache = new WeakMap<FragmentsModel, Promise<ElementRecord[]>>();

/** Every element with geometry, flattened into records (attributes, storey, property sets). */
export async function extractElements(model: FragmentsModel, onProgress?: (p: number) => void) {
  const ids = await model.getItemsIdsWithGeometry();
  const out: ElementRecord[] = [];
  for (let i = 0; i < ids.length; i += EXTRACT_BATCH) {
    const batch = await model.getItemsData(ids.slice(i, i + EXTRACT_BATCH), PROPERTIES_QUERY);
    for (const data of batch) out.push(toElementRecord(data));
    onProgress?.(Math.min(1, (i + EXTRACT_BATCH) / ids.length));
  }
  return out;
}

/** Element records of a model, extracted once and cached per model instance. */
export function modelElements(model: FragmentsModel, onProgress?: (p: number) => void) {
  let data = cache.get(model);
  if (!data) {
    data = extractElements(model, onProgress);
    cache.set(model, data);
    data.catch(() => cache.delete(model));
  }
  return data;
}

/** Element records of every open model. */
export async function openModelElements(onProgress?: (label: string, p: number) => void): Promise<ModelElements[]> {
  const out: ModelElements[] = [];
  for (const [modelId, model] of engine.models) {
    out.push({ modelId, elements: await modelElements(model, (p) => onProgress?.(modelId, p)) });
  }
  return out;
}
