import { useState } from "react";
import { loadFiles } from "./bim/actions";
import { useViewer } from "./bim/store";
import { Categories } from "./components/Categories";
import { Issues } from "./components/Issues";
import { Library } from "./components/Library";
import { ModelTree } from "./components/ModelTree";
import { Notes } from "./components/Notes";
import { Properties } from "./components/Properties";
import { Toolbar } from "./components/Toolbar";
import { Viewport } from "./components/Viewport";

type Tab = "tree" | "classes" | "library" | "issues";
const TABS: [Tab, string][] = [
  ["tree", "Tree"],
  ["classes", "Classes"],
  ["library", "Library"],
  ["issues", "Issues"],
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tree");
  const [dragging, setDragging] = useState(false);
  const loading = useViewer((s) => s.loading);
  const error = useViewer((s) => s.error);
  const setError = useViewer((s) => s.setError);

  return (
    <div className="app">
      <Toolbar />
      <aside className="panel left">
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        {/* Tree and classes stay mounted so switching tabs keeps their state. */}
        <div className="panel-body" hidden={tab !== "tree"}>
          <ModelTree />
        </div>
        <div className="panel-body" hidden={tab !== "classes"}>
          <Categories />
        </div>
        {tab === "library" && (
          <div className="panel-body">
            <Library />
          </div>
        )}
        {tab === "issues" && (
          <div className="panel-body">
            <Issues />
          </div>
        )}
      </aside>

      <main
        className={`stage${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Ignore leave events fired when moving over child elements.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          await loadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <Viewport />
        {loading && (
          <div className="overlay">
            <div className="spinner" />
            <span>{loading.label}</span>
            {loading.progress > 0 && <progress value={loading.progress} max={1} />}
          </div>
        )}
        {error && (
          <div className="toast" role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Dismiss">✕</button>
          </div>
        )}
      </main>

      <aside className="panel right">
        <h2>Properties</h2>
        <div className="panel-body">
          <Properties />
        </div>
        <Notes />
      </aside>
    </div>
  );
}
