import type { Issue, IssueComponent, NewIssue } from "../../shared/api";
import { api } from "../api/client";
import { select } from "./actions";
import { engine, HIGHLIGHT } from "./engine";
import { openFromLibrary } from "./library";
import { useViewer } from "./store";
import { applyViewpoint, captureSnapshot, captureViewpoint } from "./viewpoint";

/** The selected element as an issue component (works for unsaved models too: modelId is then null). */
export async function selectionComponent(): Promise<IssueComponent | null> {
  const { selection, models } = useViewer.getState();
  if (!selection) return null;
  const model = engine.getModel(selection.modelId);
  if (!model) return null;
  const [data] = await model.getItemsData([selection.localId], { attributesDefault: false, attributes: ["Name"] });
  const guid = (data?._guid as { value?: string } | undefined)?.value;
  if (!guid) return null;
  const name = (data.Name as { value?: unknown } | undefined)?.value;
  const category = (data._category as { value?: unknown } | undefined)?.value;
  return {
    modelId: models.find((m) => m.id === selection.modelId)?.libraryId ?? null,
    guid,
    name: name != null ? String(name) : null,
    category: category != null ? String(category) : null,
  };
}

/** Creates an issue in the current project with the current viewpoint and a snapshot. */
export async function createIssue(fields: Omit<NewIssue, "projectId" | "viewpoint" | "snapshot">) {
  const projectId = useViewer.getState().projectId;
  if (!projectId) throw new Error("Open a project first");
  const issue = await api.createIssue({ ...fields, projectId, viewpoint: captureViewpoint(), snapshot: captureSnapshot() });
  useViewer.getState().bumpLibrary();
  return issue;
}

/** Replaces an issue's viewpoint and snapshot with the current view. */
export async function updateIssueViewpoint(issueId: string) {
  const issue = await api.updateIssue(issueId, { viewpoint: captureViewpoint(), snapshot: captureSnapshot() });
  useViewer.getState().bumpLibrary();
  return issue;
}

/** Shows an issue: restores its viewpoint, opens its library models if needed and highlights its elements. */
export async function openIssue(issue: Issue) {
  const projectId = useViewer.getState().projectId;
  // Open the component models first when the viewpoint doesn't list them.
  const needed = new Set(issue.components.flatMap((c) => (c.modelId ? [c.modelId] : [])));
  for (const id of issue.viewpoint?.viewer?.models ?? []) needed.delete(id);
  if (needed.size && projectId) {
    const library = await api.listModels(projectId);
    for (const id of needed) {
      const record = library.find((m) => m.id === id);
      if (record) await openFromLibrary(record, false);
    }
  }
  await applyViewpoint(issue.viewpoint);
  await highlightComponents(issue.components);
}

/** Selects the first component and highlights the rest, across all open models. */
export async function highlightComponents(components: IssueComponent[]) {
  const guids = components.map((c) => c.guid);
  let first: { modelId: string; localId: number } | null = null;
  const others: [string, number[]][] = [];
  for (const [modelId, model] of engine.models) {
    const ids = (await model.getLocalIdsByGuids(guids)).filter((id): id is number => id != null);
    if (!ids.length) continue;
    if (!first) {
      first = { modelId, localId: ids[0] };
      if (ids.length > 1) others.push([modelId, ids.slice(1)]);
    } else others.push([modelId, ids]);
  }
  await select(first);
  for (const [modelId, ids] of others) await engine.getModel(modelId)?.highlight(ids, HIGHLIGHT);
  await engine.update(true);
  return first !== null;
}
