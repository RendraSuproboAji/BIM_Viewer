import { engine, HIGHLIGHT } from "./engine";
import { useViewer, type Selection } from "./store";

const GHOST_OPACITY = 0.12;

export const SAMPLE_IFC_URL =
  "https://raw.githubusercontent.com/ThatOpen/engine_components/main/resources/ifc/school_str.ifc";

export async function loadFile(file: File) {
  await loadBuffer(await file.arrayBuffer(), file.name);
}

export async function loadUrl(url: string) {
  const name = decodeURIComponent(url.split("/").pop() ?? "model.ifc");
  const { setLoading, setError } = useViewer.getState();
  setLoading({ label: `Downloading ${name}`, progress: 0 });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} while downloading ${name}`);
    await loadBuffer(await res.arrayBuffer(), name);
  } catch (e) {
    setError(errorMessage(e));
    setLoading(null);
  }
}

async function loadBuffer(buffer: ArrayBuffer, name: string) {
  const { setLoading, setError, addModel, requestFit, ghost } = useViewer.getState();
  const isFrag = /\.frag$/i.test(name);
  setLoading({ label: `${isFrag ? "Loading" : "Converting"} ${name}`, progress: 0 });
  try {
    const model = isFrag
      ? await engine.loadFrag(buffer, name)
      : await engine.loadIfc(buffer, name, (p) => setLoading({ label: `Converting ${name}`, progress: p }));
    if (ghost) await model.setOpacity(undefined, GHOST_OPACITY);
    addModel({ id: model.modelId, name, visible: true });
    requestFit("all");
  } catch (e) {
    console.error(e);
    setError(`Could not load ${name}: ${errorMessage(e)}`);
  } finally {
    setLoading(null);
  }
}

export async function select(selection: Selection | null) {
  const { selection: previous, select: setSelection } = useViewer.getState();
  if (previous) await engine.getModel(previous.modelId)?.resetHighlight();
  setSelection(selection);
  if (selection) await engine.getModel(selection.modelId)?.highlight([selection.localId], HIGHLIGHT);
  await engine.update(true);
}

export async function setModelVisible(modelId: string, visible: boolean) {
  const model = engine.getModel(modelId);
  if (!model) return;
  model.object.visible = visible;
  useViewer.getState().setModelVisible(modelId, visible);
  await engine.update(true);
}

export async function setItemsVisible(modelId: string, localIds: number[], visible: boolean) {
  await engine.getModel(modelId)?.setVisible(localIds, visible);
  await engine.update(true);
}

export async function isolateSelection() {
  const { selection } = useViewer.getState();
  if (!selection) return;
  for (const [id, model] of engine.models) {
    await model.setVisible(undefined, false);
    if (id === selection.modelId) await model.setVisible([selection.localId], true);
  }
  await engine.update(true);
}

export async function hideSelection() {
  const { selection } = useViewer.getState();
  if (!selection) return;
  await engine.getModel(selection.modelId)?.setVisible([selection.localId], false);
  await select(null);
}

export async function showAll() {
  for (const model of engine.models.values()) await model.resetVisible();
  for (const m of useViewer.getState().models) if (!m.visible) await setModelVisible(m.id, true);
  await engine.update(true);
}

export async function setGhost(ghost: boolean) {
  useViewer.getState().setGhost(ghost);
  for (const model of engine.models.values()) {
    if (ghost) await model.setOpacity(undefined, GHOST_OPACITY);
    else await model.resetOpacity(undefined);
  }
  await engine.update(true);
}

export async function removeModel(modelId: string) {
  await engine.disposeModel(modelId);
  useViewer.getState().removeModel(modelId);
  await engine.update(true);
}

export async function exportFrag(modelId: string) {
  const model = engine.getModel(modelId);
  if (!model) return;
  const buffer = await model.getBuffer(false);
  const url = URL.createObjectURL(new Blob([buffer]));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${modelId}.frag`;
  a.click();
  URL.revokeObjectURL(url);
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
