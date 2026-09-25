import { useState } from "react";
import { NOTE_STATUSES, type NoteStatus } from "../../shared/api";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { STATUS_LABELS } from "../bim/format";
import { NoteCard } from "./Notes";

/** Every note / issue in the library, filterable by status. */
export function Issues() {
  const [status, setStatus] = useState<NoteStatus | "">("open");
  const notes = useApi(() => api.listNotes(status ? { status } : {}), [status]);

  return (
    <div className="library">
      <div className="inline-form">
        <select value={status} onChange={(e) => setStatus(e.target.value as NoteStatus | "")} aria-label="Filter by status">
          <option value="">All statuses</option>
          {NOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="muted small">{notes.data?.length ?? 0} note(s)</span>
      </div>
      {notes.error && <p className="empty">{notes.error}</p>}
      {notes.data?.length === 0 && <p className="empty">No notes. Select an element and add one under Properties.</p>}
      {notes.data?.map((n) => <NoteCard key={n.id} note={n} showElement />)}
    </div>
  );
}
