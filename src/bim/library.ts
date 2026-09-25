import type { FragmentsModel } from "@thatopen/fragments";
import type { ElementRecord, ModelRecord, ViewState } from "../../shared/api";
import { api } from "../api/client";
import { errorMessage, loadBuffer, select, setClassesVisible, setGhost, showAll } from "./actions";
import { getCameraState, setCameraState } from "./camera";
import { engine } from "./engine";
import { PROPERTIES_QUERY, toElementRecord } from "./properties";
import { useViewer } from "./store";

const EXTRACT_BATCH = 250;

/** Uploads a loaded model to the library as .frag and stores its extracted BIM data. */
export async function saveToLibrary(modelId: string) {
  const { models, setLoading, setError, setLibraryId } = useViewer.getState();
  const info = models.find((m) => m.id === modelId);
  const model = engine.getModel(modelId);
  if (!info || !model) return;
  try {
    setLoading({ label: `Uploading ${info.name}`, progress: 0 });
    const record = await api.uploadModel(info.name, await model.getBuffer(false));
    const elements = await extractElements(model, (p) => setLoading({ label: `Extracting BIM data from ${info.name}`, progress: p }));
    setLoading({ label: `Saving ${elements.length} elements`, progress: 1 });
    await api.saveElements(record.id, elements);
    setLibraryId(modelId, record.id);
  } catch (e) {
    setError(`Could not save ${info.name} to the library: ${errorMessage(e)}`);
  } finally {
    setLoading(null);
  }
}

/** Every element with geometry, flattened into database records (attributes, storey, property sets). */
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

/** Opens a library model (or returns it if already open). Resolves to the viewer's model id. */
export async function openFromLibrary(record: Pick<ModelRecord, "id" | "name">, fit = true) {
  const open = useViewer.getState().models.find((m) => m.libraryId === record.id);
  if (open) return open.id;
  const { setLoading, setError } = useViewer.getState();
  setLoading({ label: `Downloading ${record.name}`, progress: 0 });
  try {
    const bytes = await api.modelFile(record.id);
    return await loadBuffer(bytes, record.name, { format: "frag", libraryId: record.id, fit });
  } catch (e) {
    setError(`Could not open ${record.name}: ${errorMessage(e)}`);
    setLoading(null);
    return null;
  }
}

/** Opens the element's library model if needed, then selects and frames the element. */
export async function goToElement(libraryId: string, guid: string) {
  let modelId = useViewer.getState().models.find((m) => m.libraryId === libraryId)?.id ?? null;
  if (!modelId) {
    const record = (await api.listModels()).find((m) => m.id === libraryId);
    if (!record) return useViewer.getState().setError("That model is no longer in the library");
    modelId = await openFromLibrary(record, false);
  }
  const loaded = modelId ? engine.getModel(modelId) : undefined;
  if (!modelId || !loaded) return;
  const [localId] = await loaded.getLocalIdsByGuids([guid]);
  if (localId == null) {
    useViewer.getState().setError(`Element ${guid} was not found in the model`);
    return;
  }
  await select({ modelId, localId });
  useViewer.getState().requestFit("selection");
}

export async function deleteFromLibrary(record: ModelRecord) {
  await api.deleteModel(record.id);
  // Loaded copies stay open but are no longer linked to the library.
  useViewer.setState((s) => ({
    models: s.models.map((m) => (m.libraryId === record.id ? { ...m, libraryId: undefined } : m)),
    libraryVersion: s.libraryVersion + 1,
  }));
}

/** Snapshot of the current viewer state for a saved view. */
export function captureView(): ViewState | null {
  const camera = getCameraState();
  if (!camera) return null;
  const { section, hiddenClasses, ghost, models } = useViewer.getState();
  return {
    camera,
    section: { ...section },
    hiddenClasses: [...hiddenClasses],
    ghost,
    models: models.flatMap((m) => (m.libraryId ? [m.libraryId] : [])),
  };
}

export async function applyView(state: ViewState) {
  const library = state.models.length ? await api.listModels() : [];
  for (const id of state.models) {
    const record = library.find((m) => m.id === id);
    if (record) await openFromLibrary(record, false);
  }
  await showAll();
  if (state.hiddenClasses.length) await setClassesVisible(state.hiddenClasses, false);
  await setGhost(state.ghost);
  useViewer.getState().setSection(state.section);
  await setCameraState(state.camera);
}
