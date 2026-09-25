import { useRef } from "react";
import { hideSelection, isolateSelection, loadFile, loadUrl, SAMPLE_IFC_URL, select, setGhost, showAll } from "../bim/actions";
import { useViewer, type SectionAxis } from "../bim/store";

export function Toolbar() {
  const input = useRef<HTMLInputElement>(null);
  const selection = useViewer((s) => s.selection);
  const ghost = useViewer((s) => s.ghost);
  const section = useViewer((s) => s.section);
  const setSection = useViewer((s) => s.setSection);
  const requestFit = useViewer((s) => s.requestFit);
  const hasModels = useViewer((s) => s.models.length > 0);

  return (
    <header className="toolbar">
      <strong className="brand">BIM Viewer</strong>

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
            for (const file of Array.from(e.target.files ?? [])) await loadFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="group">
        <button disabled={!hasModels} onClick={() => requestFit("all")}>Fit all</button>
        <button disabled={!selection} onClick={() => requestFit("selection")}>Zoom to selection</button>
        <button disabled={!selection} onClick={isolateSelection}>Isolate</button>
        <button disabled={!selection} onClick={hideSelection}>Hide</button>
        <button disabled={!hasModels} onClick={showAll}>Show all</button>
        <button disabled={!selection} onClick={() => select(null)}>Clear selection</button>
        <button className={ghost ? "active" : ""} disabled={!hasModels} onClick={() => setGhost(!ghost)}>
          X-ray
        </button>
      </div>

      <div className="group">
        <button className={section.enabled ? "active" : ""} disabled={!hasModels} onClick={() => setSection({ enabled: !section.enabled })}>
          Section
        </button>
        {section.enabled && (
          <>
            <select value={section.axis} onChange={(e) => setSection({ axis: e.target.value as SectionAxis })}>
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
