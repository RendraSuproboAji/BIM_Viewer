import { useState } from "react";
import { loadFile } from "./bim/actions";
import { useViewer } from "./bim/store";
import { Categories } from "./components/Categories";
import { ModelTree } from "./components/ModelTree";
import { Properties } from "./components/Properties";
import { Toolbar } from "./components/Toolbar";
import { Viewport } from "./components/Viewport";

export default function App() {
  const [tab, setTab] = useState<"tree" | "classes">("tree");
  const [dragging, setDragging] = useState(false);
  const loading = useViewer((s) => s.loading);
  const error = useViewer((s) => s.error);
  const setError = useViewer((s) => s.setError);

  return (
    <div className="app">
      <Toolbar />
      <aside className="panel left">
        <nav className="tabs">
          <button className={tab === "tree" ? "active" : ""} onClick={() => setTab("tree")}>Spatial tree</button>
          <button className={tab === "classes" ? "active" : ""} onClick={() => setTab("classes")}>Classes</button>
        </nav>
        <div className="panel-body">{tab === "tree" ? <ModelTree /> : <Categories />}</div>
      </aside>

      <main
        className={`stage${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          for (const file of Array.from(e.dataTransfer.files)) {
            if (/\.(ifc|frag)$/i.test(file.name)) await loadFile(file);
          }
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
      </aside>
    </div>
  );
}
