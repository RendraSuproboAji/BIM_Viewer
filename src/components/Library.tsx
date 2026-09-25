import { useState } from "react";
import type { ViewRecord } from "../../shared/api";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { errorMessage } from "../bim/actions";
import { prettyCategory } from "../bim/format";
import { applyView, captureView, deleteFromLibrary, goToElement, openFromLibrary } from "../bim/library";
import { useCan } from "../bim/session";
import { useViewer } from "../bim/store";
import { NoProject } from "./ProjectMenu";

/** Server-side model library, saved views and element search. */
export function Library() {
  const health = useApi(() => api.health());
  const projectId = useViewer((s) => s.projectId);
  if (health.error) {
    return (
      <p className="empty">
        The library needs the API server. Start it with <code>npm run dev</code> (or <code>npm run dev:api</code>).
        <br />
        <span className="muted">{health.error}</span>
      </p>
    );
  }
  if (!projectId) return <NoProject what="use the library" />;
  return (
    <div className="library">
      <Models projectId={projectId} />
      <Views projectId={projectId} />
      <Search projectId={projectId} />
    </div>
  );
}

function Models({ projectId }: { projectId: string }) {
  const models = useApi(() => api.listModels(projectId), [projectId]);
  const canEdit = useCan("models.write");
  const open = useViewer((s) => s.models);
  const setError = useViewer((s) => s.setError);

  return (
    <section>
      <h3>Saved models</h3>
      {models.data?.length === 0 && <p className="empty">Nothing saved yet. Use 💾 next to a loaded model.</p>}
      {models.data?.map((m) => {
        const isOpen = open.some((o) => o.libraryId === m.id);
        return (
          <div key={m.id} className="card">
            <div className="card-title" title={m.name}>
              {m.name}
            </div>
            <div className="muted small">
              {m.elementCount} elements · {formatSize(m.size)} · {new Date(m.createdAt).toLocaleDateString()}
            </div>
            <div className="card-actions">
              <button disabled={isOpen} onClick={() => openFromLibrary(m)}>
                {isOpen ? "Opened" : "Open"}
              </button>
              <a className="button" href={api.elementsCsvUrl(m.id)} download>
                CSV
              </a>
              {canEdit && <button
                onClick={async () => {
                  if (!confirm(`Delete "${m.name}" from the library? Issues keep their elements.`)) return;
                  await deleteFromLibrary(m).catch((e) => setError(errorMessage(e)));
                }}
              >
                Delete
              </button>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Views({ projectId }: { projectId: string }) {
  const views = useApi(() => api.listViews(projectId), [projectId]);
  const canEdit = useCan("views.write");
  const [name, setName] = useState("");
  const { bumpLibrary, setError } = useViewer.getState();
  const hasModels = useViewer((s) => s.models.length > 0);

  const save = async (existing?: ViewRecord) => {
    const state = captureView();
    if (!state) return;
    const unsaved = useViewer.getState().models.filter((m) => !m.libraryId).length;
    try {
      if (existing) await api.updateView(existing.id, existing.name, state);
      else await api.createView(projectId, name.trim() || `View ${new Date().toLocaleString()}`, state);
      setName("");
      bumpLibrary();
      if (unsaved) setError(`Saved. ${unsaved} open model(s) are not in the library, so the view won't reopen them.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section>
      <h3>Saved views</h3>
      {canEdit && <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" aria-label="View name" />
        <button type="submit" disabled={!hasModels}>
          Save view
        </button>
      </form>}
      {views.data?.map((v) => (
        <div key={v.id} className="row">
          <span className="label" onClick={() => applyView(v.state)} title="Restore this view">
            {v.name}
            <span className="muted"> · {v.state.models.length} model(s)</span>
          </span>
          {canEdit && (
            <>
              <button className="icon" title="Overwrite with the current view" onClick={() => save(v)}>
                ⟳
              </button>
              <button className="icon" title="Delete view" onClick={() => api.deleteView(v.id).then(bumpLibrary, (e) => setError(errorMessage(e)))}>
                ✕
              </button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

const PAGE = 50;

function Search({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [submitted, setSubmitted] = useState({ q: "", category: "", page: 0 });
  const categories = useApi(() => api.categories(projectId), [projectId]);
  const results = useApi(
    () => api.searchElements({ projectId, q: submitted.q, category: submitted.category, limit: PAGE, offset: submitted.page * PAGE }),
    [projectId, submitted],
  );
  const total = results.data?.total ?? 0;

  return (
    <section>
      <h3>Search elements</h3>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ q: query.trim(), category, page: 0 });
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, GUID, storey or property value" aria-label="Search" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Class">
          <option value="">All classes</option>
          {categories.data?.map((c) => (
            <option key={c.category} value={c.category}>
              {prettyCategory(c.category)} ({c.count})
            </option>
          ))}
        </select>
        <button type="submit">Search</button>
      </form>
      {results.error && <p className="empty">{results.error}</p>}
      {results.data && (
        <p className="muted small">
          {total} result{total === 1 ? "" : "s"}
        </p>
      )}
      {results.data?.items.map((e) => (
        <div
          key={`${e.modelId}:${e.localId}`}
          className="row result"
          onClick={() => e.guid && goToElement(e.modelId, e.guid)}
          title={e.guid ?? undefined}
        >
          <span className="label">
            {e.name || `#${e.localId}`}
            <span className="muted">
              {" "}
              · {prettyCategory(e.category)}
              {e.storey ? ` · ${e.storey}` : ""} · {e.modelName}
            </span>
          </span>
        </div>
      ))}
      {total > PAGE && (
        <div className="pager">
          <button disabled={submitted.page === 0} onClick={() => setSubmitted({ ...submitted, page: submitted.page - 1 })}>
            ‹ Prev
          </button>
          <span className="muted small">
            {submitted.page * PAGE + 1}–{Math.min(total, (submitted.page + 1) * PAGE)} of {total}
          </span>
          <button disabled={(submitted.page + 1) * PAGE >= total} onClick={() => setSubmitted({ ...submitted, page: submitted.page + 1 })}>
            Next ›
          </button>
        </div>
      )}
    </section>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
