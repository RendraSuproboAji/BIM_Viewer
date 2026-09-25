import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PROJECT_ROLES, type ProjectMember, type ProjectRole, type User, type UserRole } from "../../shared/api";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { errorMessage } from "../bim/actions";
import { capitalize } from "../bim/format";
import { refreshProjects, signOut, switchProject } from "../bim/session";
import { useViewer } from "../bim/store";

/** Project switcher + settings in the toolbar. */
export function ProjectMenu() {
  const projects = useViewer((s) => s.projects);
  const projectId = useViewer((s) => s.projectId);
  const user = useViewer((s) => s.user);
  const hasModels = useViewer((s) => s.models.length > 0);
  const [dialog, setDialog] = useState<"project" | "new" | null>(null);

  const change = (id: string) => {
    if (id === "__new") return setDialog("new");
    if (hasModels && !confirm("Switching projects closes the open models. Continue?")) return;
    void switchProject(id);
  };

  return (
    <div className="group project-menu">
      <select value={projectId ?? ""} onChange={(e) => change(e.target.value)} aria-label="Project" title="Project">
        {!projectId && <option value="">No project</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="__new">+ New project…</option>
      </select>
      <button onClick={() => setDialog("project")} title="Project, users and account settings" aria-label="Settings">
        ⚙ {user?.name}
      </button>
      {dialog === "new" && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === "project" && <SettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon visible" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasModels = useViewer((s) => s.models.length > 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const project = await api.createProject(name.trim());
      await refreshProjects();
      if (!hasModels || confirm("Open the new project now? This closes the open models.")) await switchProject(project.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal title="New project" onClose={onClose}>
      <form className="auth-form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="primary">
          Create project
        </button>
      </form>
    </Modal>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const user = useViewer((s) => s.user)!;
  const [tab, setTab] = useState<"project" | "users" | "account">("project");
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <nav className="tabs">
        <button className={tab === "project" ? "active" : ""} onClick={() => setTab("project")}>
          Project
        </button>
        {user.role === "admin" && (
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
            Users
          </button>
        )}
        <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}>
          Account
        </button>
      </nav>
      {tab === "project" && <ProjectSettings onDeleted={onClose} />}
      {tab === "users" && <UsersAdmin />}
      {tab === "account" && <AccountSettings />}
    </Modal>
  );
}

function ProjectSettings({ onDeleted }: { onDeleted: () => void }) {
  const project = useViewer((s) => s.projects.find((p) => p.id === s.projectId));
  const me = useViewer((s) => s.user)!;
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [name, setName] = useState(project?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const users = useApi(() => api.listUsers());
  const isOwner = project?.role === "owner";

  useEffect(() => {
    if (project) api.listMembers(project.id).then(setMembers, (e) => setError(errorMessage(e)));
  }, [project]);

  if (!project) return <p className="empty">No project selected.</p>;
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const candidates = (users.data ?? []).filter((u) => !members.some((m) => m.userId === u.id));

  return (
    <div className="settings-section">
      {error && <p className="form-error">{error}</p>}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.renameProject(project.id, name.trim());
            await refreshProjects();
          });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} aria-label="Project name" maxLength={200} />
        {isOwner && <button type="submit">Rename</button>}
      </form>
      <p className="muted small">Your role: {capitalize(project.role)}. Owners manage members; editors change models, views and issues; viewers read and comment.</p>

      <h3>Members</h3>
      <table className="grid-table">
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>
                {m.name} <span className="muted small">{m.email}</span>
              </td>
              <td>
                <select
                  value={m.role}
                  disabled={!isOwner}
                  onChange={(e) => run(async () => setMembers(await api.setMember(project.id, m.userId, e.target.value as ProjectRole)))}
                  aria-label={`Role of ${m.name}`}
                >
                  {PROJECT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {capitalize(r)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {(isOwner || m.userId === me.id) && (
                  <button
                    onClick={() =>
                      run(async () => {
                        if (!confirm(m.userId === me.id ? "Leave this project?" : `Remove ${m.name} from the project?`)) return;
                        setMembers(await api.removeMember(project.id, m.userId));
                        if (m.userId === me.id) {
                          const projects = await refreshProjects();
                          await switchProject(projects[0]?.id ?? null);
                          onDeleted();
                        }
                      })
                    }
                  >
                    {m.userId === me.id ? "Leave" : "Remove"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isOwner && candidates.length > 0 && <AddMember candidates={candidates} onAdd={(userId, role) => run(async () => setMembers(await api.setMember(project.id, userId, role)))} />}

      {isOwner && (
        <>
          <h3>Danger zone</h3>
          <button
            className="danger"
            onClick={() =>
              run(async () => {
                if (!confirm(`Delete "${project.name}" with all its models, views and issues? This can't be undone.`)) return;
                await api.deleteProject(project.id);
                const projects = await refreshProjects();
                await switchProject(projects[0]?.id ?? null);
                onDeleted();
              })
            }
          >
            Delete project
          </button>
        </>
      )}
    </div>
  );
}

function AddMember({ candidates, onAdd }: { candidates: User[]; onAdd: (userId: string, role: ProjectRole) => void }) {
  const [userId, setUserId] = useState(candidates[0]?.id ?? "");
  const [role, setRole] = useState<ProjectRole>("editor");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (userId) onAdd(userId, role);
      }}
    >
      <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="User to add">
        {candidates.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
      <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} aria-label="Role">
        {PROJECT_ROLES.map((r) => (
          <option key={r} value={r}>
            {capitalize(r)}
          </option>
        ))}
      </select>
      <button type="submit">Add member</button>
    </form>
  );
}

function UsersAdmin() {
  const me = useViewer((s) => s.user)!;
  const [version, setVersion] = useState(0);
  const users = useApi(() => api.listUsers(), [version]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "member" as UserRole });
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="settings-section">
      {error && <p className="form-error">{error}</p>}
      <table className="grid-table">
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <td>
                {u.name} <span className="muted small">{u.email}</span>
              </td>
              <td>
                <select value={u.role} onChange={(e) => run(() => api.updateUser(u.id, { role: e.target.value as UserRole }))} aria-label={`Role of ${u.name}`}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td>
                <button
                  onClick={() => {
                    const password = prompt(`New password for ${u.name} (at least 8 characters):`);
                    if (password) void run(() => api.updateUser(u.id, { password }));
                  }}
                >
                  Reset password
                </button>{" "}
                {u.id !== me.id && (
                  <button className="danger" onClick={() => confirm(`Delete ${u.name}?`) && run(() => api.deleteUser(u.id))}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Add user</h3>
      <form
        className="grid-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.createUser(form);
            setForm({ name: "", email: "", password: "", role: "member" });
          });
        }}
      >
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required aria-label="Name" />
        <input type="email" placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-label="E-mail" />
        <input
          type="password"
          placeholder="Initial password (8+)"
          value={form.password}
          minLength={8}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
          aria-label="Initial password"
          autoComplete="new-password"
        />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} aria-label="Role">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Add user</button>
      </form>
      <p className="muted small">New users are added to the default project. Add them to other projects from the Project tab.</p>
    </div>
  );
}

function AccountSettings() {
  const user = useViewer((s) => s.user)!;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="settings-section">
      <p>
        Signed in as <strong>{user.name}</strong> ({user.email}) · {capitalize(user.role)}
      </p>
      <h3>Change password</h3>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.changePassword(current, next);
            setMessage({ ok: true, text: "Password changed. Other sessions were signed out." });
            setCurrent("");
            setNext("");
          } catch (err) {
            setMessage({ ok: false, text: errorMessage(err) });
          }
        }}
      >
        <input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" aria-label="Current password" />
        <input type="password" placeholder="New password (8+)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" aria-label="New password" />
        {message && <p className={message.ok ? "form-ok" : "form-error"}>{message.text}</p>}
        <button type="submit">Change password</button>
      </form>
      <h3>Session</h3>
      <button onClick={() => signOut()}>Sign out</button>
    </div>
  );
}
