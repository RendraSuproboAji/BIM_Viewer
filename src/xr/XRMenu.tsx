import { useEffect, useRef, useState } from "react";
import { useViewer } from "../bim/store";
import { browserEnvironment, detectXR, DEVICE_SUPPORT, MODE_DESCRIPTIONS, MODE_LABELS, XR_MODES, type XRMode } from "./capabilities";
import { lastMode, useXRUi } from "./state";

/** Loads the XR runtime chunk (the @react-three/xr store and scene wrapper). */
const loadRuntime = () => import("./runtime");

const STATE_ICON = { ready: "✓", limited: "⚠", unavailable: "✗" } as const;

/**
 * Toolbar entry: "XR ▾" opens the mode picker. Opening it checks the device
 * (VR / AR / MR support) and preloads the XR runtime, so choosing a mode starts
 * the session straight from the click (browsers require a user gesture).
 */
export function XRMenu() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(false);
  const capabilities = useXRUi((s) => s.capabilities);
  const layerReady = useXRUi((s) => s.layerReady);
  const entering = useXRUi((s) => s.entering);
  const mode = useXRUi((s) => s.mode);
  const error = useXRUi((s) => s.error);
  const hasModels = useViewer((s) => s.models.length > 0);
  const box = useRef<HTMLDivElement>(null);
  const available = typeof navigator !== "undefined" && ("xr" in navigator || import.meta.env.DEV);

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!available) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    useXRUi.setState({ runtimeLoaded: true, error: null });
    // In development without a headset, the runtime installs the Quest 3 emulator: check after it.
    const runtime = import.meta.env.DEV ? await loadRuntime() : null;
    const emulated = runtime ? await runtime.emulatorReady() : false;
    useXRUi.setState({ capabilities: await detectXR(browserEnvironment(emulated)) });
    if (!runtime) void loadRuntime();
  };

  const choose = async (m: XRMode) => {
    const runtime = await loadRuntime();
    setOpen(false);
    await runtime.enterMode(m);
  };

  const preferred = lastMode();
  return (
    <div className="group xr-menu" ref={box}>
      <button className={mode ? "active" : ""} onClick={toggle} aria-haspopup="menu" aria-expanded={open} title="Virtual, augmented and mixed reality">
        {mode ? `${MODE_LABELS[mode]} ●` : "XR ▾"}
      </button>
      {open && (
        <div className="xr-dropdown" role="menu">
          <div className="xr-dropdown-head">
            <strong>Immersive view</strong>
            <span className="muted small">{capabilities ? capabilities.device.name : "Checking this device…"}</span>
          </div>
          {!hasModels && <p className="muted small">Open a model first.</p>}
          {XR_MODES.map((m) => {
            const status = capabilities?.modes[m];
            const usable = !!status && status.state !== "unavailable" && hasModels && layerReady && !entering;
            return (
              <button
                key={m}
                role="menuitem"
                className={`xr-mode xr-${status?.state ?? "checking"}${preferred === m ? " preferred" : ""}`}
                disabled={!usable}
                onClick={() => choose(m)}
                title={MODE_DESCRIPTIONS[m]}
              >
                <span className="xr-mode-name">
                  {status ? STATE_ICON[status.state] : "…"} {MODE_LABELS[m]}
                </span>
                <span className="xr-mode-desc">{entering === m ? "Starting…" : (status?.reason ?? MODE_DESCRIPTIONS[m])}</span>
              </button>
            );
          })}
          {error && <p className="form-error small">{error}</p>}
          <button className="link small" onClick={() => setReport(!report)}>
            {report ? "Hide" : "Show"} compatibility details
          </button>
          {report && capabilities && (
            <div className="xr-report small">
              <p>
                HTTPS: {capabilities.secure ? "yes" : "no"} · WebXR: {capabilities.webxr ? "yes" : "no"} · immersive-vr: {capabilities.immersiveVr ? "yes" : "no"} · immersive-ar:{" "}
                {capabilities.immersiveAr ? "yes" : "no"}
                {capabilities.emulated ? " · emulated" : ""}
              </p>
              {capabilities.device.notes.map((n) => (
                <p key={n} className="muted">
                  {n}
                </p>
              ))}
              <table>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>VR</th>
                    <th>AR</th>
                    <th>MR</th>
                  </tr>
                </thead>
                <tbody>
                  {DEVICE_SUPPORT.map((d) => (
                    <tr key={d.device} title={d.note}>
                      <td>{d.device}</td>
                      <td>{d.vr ? "✓" : "–"}</td>
                      <td>{d.ar ? "✓" : "–"}</td>
                      <td>{d.mr ? "✓" : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
