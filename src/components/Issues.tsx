import { useEffect, useRef, useState } from "react";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  type Issue,
  type IssueDetail as IssueDetailData,
  type IssuePatch,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/api";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { errorMessage } from "../bim/actions";
import { capitalize, formatDate, prettyCategory, PRIORITY_LABELS, STATUS_LABELS } from "../bim/format";
import { createIssue, highlightComponents, openIssue, selectionComponent, updateIssueViewpoint } from "../bim/issues";
import { useCan } from "../bim/session";
import { useViewer } from "../bim/store";
import { useAsyncValue } from "../hooks/useAsyncValue";
import { Modal, NoProject } from "./ProjectMenu";

/** Issues tab: list with filters and BCF import/export, or one issue's detail. */
export function Issues() {
  const activeIssueId = useViewer((s) => s.activeIssueId);
  return activeIssueId ? <IssueDetail id={activeIssueId} /> : <IssueList />;
}

function IssueList() {
  const projectId = useViewer((s) => s.projectId);
  const me = useViewer((s) => s.user);
  const canCreate = useCan("issues.create");
  const canImport = useCan("bcf.import");
  const [status, setStatus] = useState<IssueStatus | "active" | "">("active");
  const [assignee, setAssignee] = useState<"" | "me">("");
  const [text, setText] = useState("");
  const issues = useApi(
    () => (projectId ? api.listIssues({ projectId, status: status && status !== "active" ? status : undefined, assigneeId: assignee === "me" ? me?.id : undefined }) : Promise.resolve([])),
    [projectId, status, assignee, me?.id],
  );
  const bcfInput = useRef<HTMLInputElement>(null);
  const { setActiveIssueId, setNewIssueOpen, setError, bumpLibrary } = useViewer.getState();

  const visible = (issues.data ?? []).filter(
    (i) =>
      (status !== "active" || i.status === "open" || i.status === "in_progress") &&
      (!text || `#${i.number} ${i.title} ${i.description} ${i.labels.join(" ")}`.toLowerCase().includes(text.toLowerCase())),
  );

  if (!projectId) return <NoProject what="track issues" />;
  return (
    <div className="library">
      <div className="inline-form">
        {canCreate && (
          <button className="primary" onClick={() => setNewIssueOpen(true)}>
            + New issue
          </button>
        )}
        <a className="button" href={api.bcfExportUrl(projectId, visible.map((i) => i.id))} download title="Export the listed issues as BCF 2.1">
          Export BCF
        </a>
        {canImport && (
          <button onClick={() => bcfInput.current?.click()} title="Import a .bcfzip from Revit, Navisworks, Solibri, BIMcollab…">
            Import BCF
          </button>
        )}
        <input
          ref={bcfInput}
          type="file"
          accept=".bcf,.bcfzip,.zip"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const result = await api.importBcf(projectId, await file.arrayBuffer());
              bumpLibrary();
              setError(`Imported ${file.name}: ${result.created} new, ${result.updated} updated issue(s).`);
            } catch (err) {
              setError(`BCF import failed: ${errorMessage(err)}`);
            }
          }}
        />
      </div>
      <div className="inline-form">
        <select value={status} onChange={(e) => setStatus(e.target.value as IssueStatus | "active" | "")} aria-label="Status filter">
          <option value="active">Open + in progress</option>
          <option value="">All statuses</option>
          {ISSUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value as "" | "me")} aria-label="Assignee filter">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter…" aria-label="Filter issues" />
      </div>
      {issues.error && <p className="empty">{issues.error}</p>}
      {issues.data && visible.length === 0 && <p className="empty">No issues match.</p>}
      {visible.map((i) => (
        <IssueCard key={i.id} issue={i} onOpen={() => setActiveIssueId(i.id)} />
      ))}
    </div>
  );
}

export function IssueCard({ issue, onOpen }: { issue: Issue; onOpen: () => void }) {
  return (
    <button className={`card issue-card status-${issue.status}`} onClick={onOpen}>
      {issue.hasSnapshot && <img src={api.snapshotUrl(issue)} alt="" loading="lazy" />}
      <span className="issue-card-body">
        <span className="card-title">
          #{issue.number} {issue.title}
        </span>
        <span className="muted small">
          <span className={`chip status-${issue.status}`}>{STATUS_LABELS[issue.status]}</span>{" "}
          {issue.priority !== "normal" && <span className={`chip priority-${issue.priority}`}>{PRIORITY_LABELS[issue.priority]}</span>} {capitalize(issue.type)}
          {issue.assigneeName && ` · ${issue.assigneeName}`}
          {issue.dueDate && ` · due ${formatDate(issue.dueDate)}`}
          {issue.commentCount > 0 && ` · 💬 ${issue.commentCount}`}
        </span>
      </span>
    </button>
  );
}

function IssueDetail({ id }: { id: string }) {
  const projectId = useViewer((s) => s.projectId);
  const me = useViewer((s) => s.user)!;
  const libraryVersion = useViewer((s) => s.libraryVersion);
  const canManage = useCan("issues.manage");
  const canEditOwn = useCan("issues.editOwn");
  const canComment = useCan("comments.create");
  const canModerate = useCan("comments.moderate");
  const [issue, setIssue] = useState<IssueDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const members = useApi(() => (projectId ? api.listMembers(projectId) : Promise.resolve([])), [projectId]);
  const { setActiveIssueId, bumpLibrary } = useViewer.getState();

  useEffect(() => {
    let cancelled = false;
    api.getIssue(id).then(
      (i) => !cancelled && setIssue(i),
      (e) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [id, libraryVersion]);

  const run = async (action: () => Promise<IssueDetailData | void>) => {
    setError(null);
    try {
      const updated = await action();
      if (updated) setIssue(updated);
      bumpLibrary();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const patch = (p: IssuePatch) => run(() => api.updateIssue(id, p));

  if (!issue) {
    return (
      <div className="library">
        <button className="link" onClick={() => setActiveIssueId(null)}>
          ‹ All issues
        </button>
        <p className="empty">{error ?? "Loading…"}</p>
      </div>
    );
  }

  // Editors and admins edit everything; clients the content of issues they raised, not triage.
  const canEdit = canManage || (canEditOwn && issue.authorId === me.id);
  const canTriage = canManage;

  return (
    <div className="library issue-detail">
      <div className="inline-form">
        <button className="link" onClick={() => setActiveIssueId(null)}>
          ‹ All issues
        </button>
        <span className="muted small">
          #{issue.number} · by {issue.authorName ?? "unknown"} · {formatDate(issue.createdAt)}
        </span>
      </div>
      {error && <p className="form-error">{error}</p>}
      <EditableText value={issue.title} disabled={!canEdit} onSave={(title) => patch({ title })} className="issue-title" label="Title" />

      {issue.hasSnapshot && (
        <a href={api.snapshotUrl(issue)} target="_blank" rel="noreferrer" title="Open the snapshot">
          <img className="issue-snapshot" src={api.snapshotUrl(issue)} alt="Issue snapshot" />
        </a>
      )}
      <div className="inline-form">
        <button className="primary" onClick={() => openIssue(issue)} disabled={!issue.viewpoint && !issue.components.length}>
          Show in model
        </button>
        {canEdit && (
          <button onClick={() => run(() => updateIssueViewpoint(issue.id))} title="Replace the viewpoint and snapshot with the current view">
            Update viewpoint
          </button>
        )}
      </div>

      <div className="field-grid">
        <label>
          Status
          <select value={issue.status} disabled={!canTriage} onChange={(e) => patch({ status: e.target.value as IssueStatus })}>
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={issue.priority} disabled={!canTriage} onChange={(e) => patch({ priority: e.target.value as IssuePriority })}>
            {ISSUE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={issue.type} disabled={!canEdit} onChange={(e) => patch({ type: e.target.value })}>
            {[...new Set([...ISSUE_TYPES, issue.type])].map((t) => (
              <option key={t} value={t}>
                {capitalize(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignee
          <select value={issue.assigneeId ?? ""} disabled={!canTriage} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {issue.assigneeId && !members.data?.some((m) => m.userId === issue.assigneeId) && <option value={issue.assigneeId}>{issue.assigneeName}</option>}
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due
          <input type="date" value={issue.dueDate ?? ""} disabled={!canTriage} onChange={(e) => patch({ dueDate: e.target.value || null })} />
        </label>
        <label>
          Labels
          <EditableText
            value={issue.labels.join(", ")}
            disabled={!canEdit}
            label="Labels"
            placeholder="comma, separated"
            onSave={(v) => patch({ labels: [...new Set(v.split(",").map((l) => l.trim()).filter(Boolean))] })}
          />
        </label>
      </div>

      <h3>Description</h3>
      <EditableText value={issue.description} disabled={!canEdit} multiline label="Description" placeholder="No description" onSave={(description) => patch({ description })} />

      <h3>Elements ({issue.components.length})</h3>
      {issue.components.map((c) => (
        <div key={c.guid} className="row">
          <span className="label" onClick={() => highlightComponents([c])} title={c.guid}>
            {c.name || c.guid}
            {c.category && <span className="muted"> · {prettyCategory(c.category)}</span>}
          </span>
          {canEdit && (
            <button className="icon" title="Remove from issue" onClick={() => patch({ components: issue.components.filter((x) => x.guid !== c.guid) })}>
              ✕
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <button
          onClick={() =>
            run(async () => {
              const c = await selectionComponent();
              if (!c) throw new Error("Select an element in the viewer first");
              if (issue.components.some((x) => x.guid === c.guid)) return;
              return api.updateIssue(id, { components: [...issue.components, c] });
            })
          }
        >
          + Add selected element
        </button>
      )}

      <h3>Comments ({issue.comments.length})</h3>
      {issue.comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="muted small">
            <strong>{c.authorName ?? "unknown"}</strong> · {new Date(c.createdAt).toLocaleString()}
            {(c.authorId === me.id || canModerate) && (
              <button className="icon" title="Delete comment" onClick={() => confirm("Delete this comment?") && run(async () => {
                await api.deleteComment(c.id);
                return api.getIssue(id);
              })}>
                ✕
              </button>
            )}
          </div>
          <p>{c.body}</p>
        </div>
      ))}
      {canComment && <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!comment.trim()) return;
          void run(async () => {
            const updated = await api.addComment(id, comment.trim());
            setComment("");
            return updated;
          });
        }}
      >
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Write a comment…" aria-label="Comment" />
        <button type="submit" disabled={!comment.trim()}>
          Comment
        </button>
      </form>}

      {canManage && (
        <>
          <h3>&nbsp;</h3>
          <button
            className="danger"
            onClick={() =>
              confirm(`Delete issue #${issue.number}?`) &&
              run(async () => {
                await api.deleteIssue(id);
                setActiveIssueId(null);
              })
            }
          >
            Delete issue
          </button>
        </>
      )}
    </div>
  );
}

/** Text that saves on blur/Enter (or Ctrl+Enter when multiline). */
function EditableText(props: {
  value: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(props.value);
  // Follow the saved value when it changes (e.g. after a save or a reload).
  const [saved, setSaved] = useState(props.value);
  if (props.value !== saved) {
    setSaved(props.value);
    setValue(props.value);
  }
  const save = () => {
    if (value !== props.value && (value.trim() || props.multiline || props.label === "Labels")) props.onSave(value);
    else setValue(props.value);
  };
  const common = {
    value,
    disabled: props.disabled,
    "aria-label": props.label,
    placeholder: props.placeholder,
    className: props.className,
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onBlur: save,
  };
  return props.multiline ? (
    <textarea {...common} rows={4} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.target as HTMLTextAreaElement).blur()} />
  ) : (
    <input {...common} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

/** Dialog for a new issue: captures the current view and (optionally) the selected element. */
export function NewIssueDialog() {
  const open = useViewer((s) => s.newIssueOpen);
  const projectId = useViewer((s) => s.projectId);
  const hasSelection = useViewer((s) => !!s.selection);
  // Clients raise issues; editors and admins also set priority, assignee and due date.
  const canTriage = useCan("issues.manage");
  const members = useApi(() => (projectId && open && canTriage ? api.listMembers(projectId) : Promise.resolve([])), [projectId, open, canTriage]);
  const [form, setForm] = useState({ title: "", description: "", type: "issue", priority: "normal" as IssuePriority, assigneeId: "", dueDate: "", labels: "" });
  const [withSelection, setWithSelection] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setNewIssueOpen, setActiveIssueId } = useViewer.getState();
  if (!open) return null;
  const close = () => {
    setNewIssueOpen(false);
    setError(null);
  };

  return (
    <Modal title="New issue" onClose={close}>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const component = withSelection && hasSelection ? await selectionComponent() : null;
            const issue = await createIssue({
              title: form.title.trim(),
              description: form.description,
              type: form.type,
              ...(canTriage ? { priority: form.priority, assigneeId: form.assigneeId || null, dueDate: form.dueDate || null } : {}),
              labels: [...new Set(form.labels.split(",").map((l) => l.trim()).filter(Boolean))],
              components: component ? [component] : [],
            });
            setForm({ title: "", description: "", type: "issue", priority: "normal", assigneeId: "", dueDate: "", labels: "" });
            close();
            setActiveIssueId(issue.id);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Title
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={255} autoFocus />
        </label>
        <label>
          Description
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        </label>
        <div className="field-grid">
          <label>
            Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {capitalize(t)}
                </option>
              ))}
            </select>
          </label>
{canTriage && (
            <>
          <label>
            Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as IssuePriority })}>
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
              <option value="">Unassigned</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </label>
            </>
          )}
        </div>
        <label>
          Labels
          <input value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} placeholder="comma, separated" />
        </label>
        {hasSelection && (
          <label className="check-row">
            <input type="checkbox" checked={withSelection} onChange={(e) => setWithSelection(e.target.checked)} /> Attach the selected element
          </label>
        )}
        <p className="muted small">The current camera, section and a snapshot are saved with the issue.</p>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !form.title.trim()}>
          {busy ? "Creating…" : "Create issue"}
        </button>
      </form>
    </Modal>
  );
}

/** Issues of the selected element, under Properties. */
export function ElementIssues() {
  const selection = useViewer((s) => s.selection);
  const projectId = useViewer((s) => s.projectId);
  const canCreate = useCan("issues.create");
  const guid = useAsyncValue(selection, async (sel) => (sel ? ((await selectionComponent())?.guid ?? null) : null)).value ?? null;
  const issues = useApi(() => (projectId && guid ? api.listIssues({ projectId, guid }) : Promise.resolve([])), [projectId, guid]);
  const { setActiveIssueId, setNewIssueOpen } = useViewer.getState();
  if (!selection || !projectId) return null;

  return (
    <div className="notes">
      <h2>
        Issues ({issues.data?.length ?? 0})
        {canCreate && (
          <button className="link" onClick={() => setNewIssueOpen(true)}>
            + New
          </button>
        )}
      </h2>
      <div className="panel-body">
        {issues.data?.length === 0 && <p className="empty">No issues for this element.</p>}
        {issues.data?.map((i) => (
          <IssueCard key={i.id} issue={i} onOpen={() => setActiveIssueId(i.id)} />
        ))}
      </div>
    </div>
  );
}
