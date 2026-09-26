import { setGhost } from "../bim/actions";
import { useViewer } from "../bim/store";
import { Properties } from "../components/Properties";
import { exitXR } from "./runtime";
import { SCALES, useXRUi } from "./state";

/**
 * Handheld AR: HTML controls over the camera view (WebXR DOM overlay).
 * Taps on these controls don't reach the 3D scene; taps elsewhere select or place.
 */
export function ARControls() {
  const scale = useXRUi((s) => s.scale);
  const placed = useXRUi((s) => s.placed);
  const section = useViewer((s) => s.section);
  const ghost = useViewer((s) => s.ghost);
  const selection = useViewer((s) => s.selection);
  const { setSection } = useViewer.getState();

  return (
    <div className="xr-ar">
      <div className="xr-ar-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="xr-ar-hint">{placed ? "Tap an element to select it" : "Aim at a surface and tap to place the model"}</span>
        <select value={scale} onChange={(e) => useXRUi.setState({ scale: Number(e.target.value) })} aria-label="Scale">
          {SCALES.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button onClick={() => useXRUi.setState((st) => ({ placeRequest: st.placeRequest + 1 }))}>Re-place</button>
        <button className={section.enabled ? "active" : ""} onClick={() => setSection({ enabled: !section.enabled })}>
          Section
        </button>
        {section.enabled && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={section.offset}
            onChange={(e) => setSection({ offset: Number(e.target.value) })}
            aria-label="Section position"
          />
        )}
        <button className={ghost ? "active" : ""} onClick={() => void setGhost(!ghost)}>
          X-ray
        </button>
        <button onClick={exitXR}>Exit AR</button>
      </div>
      {selection && (
        <div className="xr-ar-props" onPointerDown={(e) => e.stopPropagation()}>
          <Properties />
        </div>
      )}
    </div>
  );
}
