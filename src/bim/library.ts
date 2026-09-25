import type { ModelRecord, ViewState } from "../../shared/api";
import { api } from "../api/client";
import { errorMessage, loadBuffer, select, setClassesVisible, setGhost, showAll } from "./actions";
import { getCameraState, setCameraState } from "./camera";
import { engine } from "./engine";
import { modelElements } from "./model-data";
import { useViewer } from "./store";

// In-flight operations, so double clicks don't upload or open the same model twice.
const saving = new Map<string, Promise<void>>();
const opening = new Map<string, Promise<string | null>>();

/** Uploads a loaded model to the library as .frag and stores its extracted BIM data. */
export function saveToLibrary(modelId: string) {
  let run = saving.get(modelId);
  if (!run) {
    run = doSave(modelId).finally(() => saving.delete(modelId));
    saving.set(modelId, run);
  }
  return run;
}

async function doSave(modelId: string) {
  const { models, setLoading, setError, setLibraryId } = useViewer.getState();
  const info = models.find((m) => m.id === modelId);
  const model = engine.getModel(modelId);
  if (!info || !model || info.libraryId) return;
  let uploadedId: string | null = null;
  try {
    // Extract first: it is the step most likely to fail, and nothing is on the server yet.
    // Cached: free when the takeoff or colour-by already read the model.
    const elements = await modelElements(model, (p) => setLoading({ label: `Extracting BIM data from ${info.name}`, progress: p }));
    setLoading({ label: `Uploading ${info.name}`, progress: 0 });
    const projectId = useViewer.getState().projectId;
    if (!projectId) throw new Error("Open a project first");
    const record = await api.uploadModel(projectId, info.name, await model.getBuffer(false));
    uploadedId = record.id;
    setLoading({ label: `Saving ${elements.length} elements`, progress: 1 });
    await api.saveElements(record.id, elements);
    setLibraryId(modelId, record.id);
  } catch (e) {
    // Don't leave a half-saved library entry (file without element data) behind.
    if (uploadedId) await api.deleteModel(uploadedId).catch(() => {});
    setError(`Could not save ${info.name} to the library: ${errorMessage(e)}`);
  } finally {
    setLoading(null);
  }
}

/** Opens a library model (or returns it if already open). Resolves to the viewer's model id. */
export function openFromLibrary(record: Pick<ModelRecord, "id" | "name">, fit = true): Promise<string | null> {
  const open = useViewer.getState().models.find((m) => m.libraryId === record.id);
  if (open) return Promise.resolve(open.id);
  let run = opening.get(record.id);
  if (!run) {
    run = doOpen(record, fit).finally(() => opening.delete(record.id));
    opening.set(record.id, run);
  }
  return run;
}

async function doOpen(record: Pick<ModelRecord, "id" | "name">, fit: boolean) {
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
    const projectId = useViewer.getState().projectId;
    const record = projectId ? (await api.listModels(projectId)).find((m) => m.id === libraryId) : undefined;
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
  const projectId = useViewer.getState().projectId;
  const library = state.models.length && projectId ? await api.listModels(projectId) : [];
  let missing = 0;
  for (const id of state.models) {
    const record = library.find((m) => m.id === id);
    if (record) await openFromLibrary(record, false);
    else missing++;
  }
  if (missing) useViewer.getState().setError(`${missing} model(s) of this view are no longer in the library`);
  await showAll();
  if (state.hiddenClasses.length) await setClassesVisible(state.hiddenClasses, false);
  await setGhost(state.ghost);
  useViewer.getState().setSection(state.section);
  await setCameraState(state.camera);
}
