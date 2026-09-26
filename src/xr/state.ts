import { create } from "zustand";
import type { XRCapabilities, XRMode } from "./capabilities";

/**
 * XR UI state. Deliberately free of XR library imports: the toolbar reads it
 * without loading the XR chunk (see ./runtime.ts, loaded on demand).
 */
interface XRUiState {
  /** Result of the compatibility check (null until run). */
  capabilities: XRCapabilities | null;
  /** The XR runtime chunk should wrap the scene (set when the XR menu opens). */
  runtimeLoaded: boolean;
  /** The <XR> wrapper is mounted, so sessions can start. */
  layerReady: boolean;
  /** Mode being entered (until the session starts). */
  entering: XRMode | null;
  /** Mode of the running session (confirmed from the session), or null outside XR. */
  mode: XRMode | null;
  /** Optional features the running session granted. */
  features: string[];
  /** Model scale: 1 = 1:1, 0.01 = 1:100. */
  scale: number;
  /** AR/MR: the model has been placed on a real surface. */
  placed: boolean;
  /** Bumped to ask the placement to start over. */
  placeRequest: number;
  /** VR: bumped to move the user back to the start position. */
  homeRequest: number;
  error: string | null;
  /** Last measured distance in XR (metres), shown in the wrist menu. */
  lastDistance: number | null;
}

export const useXRUi = create<XRUiState>(() => ({
  capabilities: null,
  runtimeLoaded: false,
  layerReady: false,
  entering: null,
  mode: null,
  features: [],
  scale: 1,
  placed: false,
  placeRequest: 0,
  homeRequest: 0,
  error: null,
  lastDistance: null,
}));

/** Scales offered for tabletop placement and the VR overview. */
export const SCALES: { label: string; value: number }[] = [
  { label: "1:1", value: 1 },
  { label: "1:50", value: 1 / 50 },
  { label: "1:100", value: 1 / 100 },
  { label: "1:200", value: 1 / 200 },
];

export const scaleLabel = (scale: number) => SCALES.find((s) => Math.abs(s.value - scale) < 1e-9)?.label ?? `1:${Math.round(1 / scale)}`;

/** Default scale when entering a mode: 1:1 walkthrough in VR, a table-sized model in AR/MR. */
export const defaultScale = (mode: XRMode) => (mode === "vr" ? 1 : 1 / 100);

/** Last chosen mode, remembered per browser. */
const LAST_MODE_KEY = "bim.xr.lastMode";
export function rememberMode(mode: XRMode) {
  try {
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    // Storage may be unavailable (private mode); remembering is only a convenience.
  }
}
export function lastMode(): XRMode | null {
  try {
    const v = localStorage.getItem(LAST_MODE_KEY);
    return v === "vr" || v === "ar" || v === "mr" ? v : null;
  } catch {
    return null;
  }
}
