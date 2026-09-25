import type { User } from "../../shared/api";
import { api, newSessionEpoch, setUnauthorizedHandler } from "../api/client";
import { HIDDEN_BY_DEFAULT } from "./ifc-classes";
import { removeModel, select } from "./actions";
import { useViewer } from "./store";

const lastProjectKey = (user: User) => `bim:lastProject:${user.id}`;

function remember(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable (private mode); remembering the project is only a convenience.
  }
}

function recall(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** After signing in: load projects and reopen the last one used. */
export async function startSession(user: User) {
  newSessionEpoch();
  const { setUser, setProjects } = useViewer.getState();
  setUser(user);
  const projects = await api.listProjects();
  setProjects(projects);
  const last = recall(lastProjectKey(user));
  const pick = projects.find((p) => p.id === last) ?? projects[0] ?? null;
  await switchProject(pick?.id ?? null);
}

export async function refreshProjects() {
  const projects = await api.listProjects();
  useViewer.getState().setProjects(projects);
  return projects;
}

/**
 * Opens another project. Models, issues and views belong to a project, so
 * loaded models are closed and per-project state is reset.
 */
export async function switchProject(projectId: string | null) {
  const state = useViewer.getState();
  if (state.projectId === projectId) return;
  await select(null);
  for (const m of [...state.models]) await removeModel(m.id);
  state.clearMeasurements();
  state.setProjectId(projectId);
  if (state.user) remember(lastProjectKey(state.user), projectId);
}

export async function signOut() {
  newSessionEpoch();
  await switchProject(null);
  await api.logout().catch(() => {});
  // Nothing of the previous user's session may leak into the next one.
  useViewer.setState({
    user: null,
    projects: [],
    selection: null,
    section: { enabled: false, axis: "y", offset: 0.5, flipped: false },
    ghost: false,
    hiddenClasses: new Set(HIDDEN_BY_DEFAULT),
    tool: "select",
    measurements: [],
    draft: [],
    activeIssueId: null,
    newIssueOpen: false,
    error: null,
  });
}

/** Any 401 from the API (expired session) returns to the sign-in screen. */
setUnauthorizedHandler(() => {
  if (useViewer.getState().user) void signOut();
});

export function currentRole() {
  const { projects, projectId } = useViewer.getState();
  return projects.find((p) => p.id === projectId)?.role ?? null;
}

/** Whether the user may change models, views and issues in the current project. */
export function useCanEdit() {
  return useViewer((s) => {
    const role = s.projects.find((p) => p.id === s.projectId)?.role;
    return role === "owner" || role === "editor";
  });
}
