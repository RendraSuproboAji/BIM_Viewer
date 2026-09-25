import { useRef } from "react";
import { hideSelection, isolateSelection, loadFiles, loadUrl, SAMPLE_IFC_URL, select, setGhost, showAll } from "../bim/actions";
import { useCan } from "../bim/session";
import { useViewer, type SectionAxis } from "../bim/store";
import { ProjectMenu } from "./ProjectMenu";

export function Toolbar() {
  const input = useRef<HTMLInputElement>(null);
  const selection = useViewer((s) => s.selection);
  const ghost = useViewer((s) => s.ghost);
  const section = useViewer((s) => s.section);
  const setSection = useViewer((s) => s.setSection);
  const requestFit = useViewer((s) => s.requestFit);
  const hasModels = useViewer((s) => s.models.length > 0);
  const tool = useViewer((s) => s.tool);
  const canCreateIssue = useCan("issues.create");
  const setNewIssueOpen = useViewer((s) => s.setNewIssueOpen);
  const setTool = useViewer((s) => s.setTool);

  return (
    <header className="toolbar">
      <strong className="brand">BIM Viewer</strong>
      <ProjectMenu />

      <div className="group">
        <button onClick={() => input.current?.click()}>Open IFC / FRAG</button>
        <button onClick={() => loadUrl(SAMPLE_IFC_URL)}>Load sample</button>
        <input
          ref={input}
          type="file"
          accept=".ifc,.frag"
          multiple
          hidden
          onChange={async (e) => {
            await loadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      <div className="group">
        <button disabled={!hasModels} onClick={() => requestFit("all")}>Fit all</button>
        <button disabled={!selection} onClick={() => requestFit("selection")}>Zoom to selection</button>
        <button disabled={!selection} onClick={isolateSelection}>Isolate</button>
        <button disabled={!selection} onClick={hideSelection}>Hide</button>
        <button disabled={!hasModels} onClick={showAll} title="Show every element, including spaces and openings">Show all</button>
        <button disabled={!selection} onClick={() => select(null)}>Clear selection</button>
        {canCreateIssue && (
          <button disabled={!hasModels} onClick={() => setNewIssueOpen(true)} title="Create an issue with the current view">
            + Issue
          </button>
        )}
        <button className={ghost ? "active" : ""} disabled={!hasModels} onClick={() => setGhost(!ghost)}>
          X-ray
        </button>
      </div>

      <div className="group">
        <span className="muted small">Measure</span>
        {(["distance", "area", "angle"] as const).map((t) => (
          <button key={t} className={tool === t ? "active" : ""} disabled={!hasModels} onClick={() => setTool(tool === t ? "select" : t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="group">
        <button className={section.enabled ? "active" : ""} disabled={!hasModels} onClick={() => setSection({ enabled: !section.enabled })}>
          Section
        </button>
        {section.enabled && (
          <>
            <select aria-label="Section axis" value={section.axis} onChange={(e) => setSection({ axis: e.target.value as SectionAxis })}>
              <option value="x">X</option>
              <option value="y">Y (plan)</option>
              <option value="z">Z</option>
            </select>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={section.offset}
              onChange={(e) => setSection({ offset: Number(e.target.value) })}
              aria-label="Section position"
            />
            <button onClick={() => setSection({ flipped: !section.flipped })}>Flip</button>
          </>
        )}
      </div>
    </header>
  );
}
