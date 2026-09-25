import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AuthStatus } from "../../shared/api";
import { api } from "../api/client";
import { errorMessage } from "../bim/actions";
import { startSession } from "../bim/session";
import { useViewer } from "../bim/store";

/** Shows the first-run setup or sign-in screen until a user is signed in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const user = useViewer((s) => s.user);
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) return;
    api.status().then(
      async (s) => {
        setStatus(s);
        if (s.user) await startSession(s.user);
      },
      (e) => setError(errorMessage(e)),
    );
  }, [user]);

  if (user || offline) return <>{children}</>;
  if (error) {
    return (
      <Screen title="BIM Viewer" subtitle="The server (library, projects, issues) is not reachable.">
        <p className="form-error">{error}</p>
        <div className="inline-form">
          <button className="primary" onClick={() => location.reload()}>
            Retry
          </button>
          <button onClick={() => setOffline(true)}>Use the viewer without the server</button>
        </div>
      </Screen>
    );
  }
  if (!status) return <Screen title="BIM Viewer"><p className="muted">Connecting…</p></Screen>;
  return status.setupRequired ? <Setup /> : <Login />;
}

function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(async () => startSession(await api.login(email, password)));
  return (
    <Screen title="Sign in" subtitle="BIM Viewer">
      <form className="auth-form" onSubmit={submit}>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small">Accounts are created by an administrator.</p>
      </form>
    </Screen>
  );
}

function Setup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error("The passwords don't match");
    await startSession(await api.setup({ name, email, password }));
  });
  return (
    <Screen title="Welcome" subtitle="Create the administrator account to get started.">
      <form className="auth-form" onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={120} />
        </label>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password <span className="muted small">(at least 8 characters)</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <label>
          Confirm password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create administrator"}
        </button>
      </form>
    </Screen>
  );
}
