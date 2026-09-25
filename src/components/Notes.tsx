import { useEffect, useState } from "react";
import { NOTE_STATUSES, type NoteRecord, type NoteStatus } from "../../shared/api";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { errorMessage } from "../bim/actions";
import { engine } from "../bim/engine";
import { prettyCategory, STATUS_LABELS } from "../bim/format";
import { goToElement, saveToLibrary } from "../bim/library";
import { useViewer } from "../bim/store";

/** Notes / issues attached to the selected element (stored by GUID in the library). */
export function Notes() {
  const selection = useViewer((s) => s.selection);
  const info = useViewer((s) => s.models.find((m) => m.id === selection?.modelId));
  const [element, setElement] = useState<{ guid: string; name: string | null; category: string | null } | null>(null);

  useEffect(() => {
    setElement(null);
    if (!selection) return;
    let cancelled = false;
    engine
      .getModel(selection.modelId)
      ?.getItemsData([selection.localId], { attributesDefault: false, attributes: ["Name"] })
      .then(([data]) => {
        const guid = data?._guid as { value?: string } | undefined;
        if (cancelled || !guid?.value) return;
        const name = (data.Name as { value?: unknown } | undefined)?.value;
        const category = (data._category as { value?: unknown } | undefined)?.value;
        setElement({ guid: guid.value, name: name != null ? String(name) : null, category: category != null ? String(category) : null });
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  if (!selection || !info) return null;
  if (!info.libraryId) {
    return (
      <div className="notes">
        <h2>Notes</h2>
        <p className="empty">
          Notes are stored in the library.{" "}
          <button onClick={() => saveToLibrary(info.id)}>💾 Save model to library</button>
        </p>
      </div>
    );
  }
  if (!element) return null;
  return <ElementNotes libraryId={info.libraryId} element={element} />;
}

function ElementNotes(props: { libraryId: string; element: { guid: string; name: string | null; category: string | null } }) {
  const { libraryId, element } = props;
  const notes = useApi(() => api.listNotes({ modelId: libraryId, guid: element.guid }), [libraryId, element.guid]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { bumpLibrary, setError } = useViewer.getState();

  const add = async () => {
    if (!title.trim()) return;
    try {
      await api.createNote({ modelId: libraryId, elementGuid: element.guid, elementName: element.name, category: element.category, title: title.trim(), body });
      setTitle("");
      setBody("");
      bumpLibrary();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="notes">
      <h2>Notes ({notes.data?.length ?? 0})</h2>
      <div className="panel-body">
        {notes.data?.map((n) => <NoteCard key={n.id} note={n} />)}
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New note / issue title" aria-label="Note title" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" rows={2} aria-label="Note details" />
          <button type="submit" disabled={!title.trim()}>
            Add note
          </button>
        </form>
      </div>
    </div>
  );
}

export function NoteCard({ note, showElement = false }: { note: NoteRecord; showElement?: boolean }) {
  const { bumpLibrary, setError } = useViewer.getState();
  const update = (patch: Parameters<typeof api.updateNote>[1]) => api.updateNote(note.id, patch).then(bumpLibrary, (e) => setError(errorMessage(e)));

  return (
    <div className={`card note status-${note.status}`}>
      <div className="card-title">{note.title}</div>
      {showElement && (
        <button className="link" onClick={() => goToElement(note.modelId, note.elementGuid)}>
          {note.elementName || note.elementGuid}
          {note.category && <span className="muted"> · {prettyCategory(note.category)}</span>}
        </button>
      )}
      {note.body && <p className="note-body">{note.body}</p>}
      <div className="card-actions">
        <select value={note.status} onChange={(e) => update({ status: e.target.value as NoteStatus })} aria-label="Status">
          {NOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="muted small">{new Date(note.updatedAt).toLocaleString()}</span>
        <button
          className="icon"
          title="Delete note"
          onClick={() => confirm("Delete this note?") && api.deleteNote(note.id).then(bumpLibrary, (e) => setError(errorMessage(e)))}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
