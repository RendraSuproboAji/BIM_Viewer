import { createXRStore } from "@react-three/xr";
import { useViewer } from "../bim/store";
import { confirmSession, type XRMode } from "./capabilities";
import { BimController, BimHand, BimScreenInput, BimTransientPointer } from "./inputs";
import { defaultScale, rememberMode, useXRUi } from "./state";

/**
 * The XR runtime: loaded on demand (dynamic import) when the user picks a mode,
 * so desktop users never download @react-three/xr.
 */

/**
 * Development: `?xr-automation` installs a bare emulated Quest 3 (no emulator UI,
 * which would otherwise own the controller poses) for the browser tests.
 */
const automation = import.meta.env.DEV && new URLSearchParams(location.search).has("xr-automation");

export const xrStore = createXRStore({
  // The IWER Quest 3 emulator (with its control UI), only in development and only when
  // no real XR device is present.
  emulate: import.meta.env.DEV && !automation ? { type: "metaQuest3", syntheticEnvironment: false, inject: true } : false,
  // Sessions start from our mode picker, never from a browser prompt.
  offerSession: false,
  enterGrantedSession: false,
  // Every feature is optional: each mode uses what the session grants (see MODE_FEATURES).
  handTracking: true,
  hitTest: true,
  anchors: true,
  planeDetection: true,
  meshDetection: true,
  // Depth sensing lets three.js hide the model behind real objects (Quest 3).
  depthSensing: true,
  domOverlay: true,
  layers: false,
  frameRate: "high",
  // Controller and hand models come from the WebXR input-profiles CDN by default;
  // air-gapped sites can serve a copy themselves (see README, "XR").
  ...(import.meta.env.VITE_XR_ASSETS ? { baseAssetPath: import.meta.env.VITE_XR_ASSETS } : {}),
  // Custom inputs: the default visuals plus a BIM ray that selects, teleports and measures.
  controller: BimController,
  hand: BimHand,
  screenInput: BimScreenInput,
  transientPointer: BimTransientPointer,
});

/**
 * Resolves once the emulator has had a chance to install (development only).
 * Desktop Chromium exposes a native navigator.xr even without a headset; IWER
 * then declines to replace it, so it's installed explicitly here.
 */
export async function emulatorReady() {
  if (!import.meta.env.DEV) return false;
  if (automation) {
    if (!xrStore.getState().emulator) {
      const { XRDevice, metaQuest3 } = await import("iwer");
      const device = new XRDevice(metaQuest3);
      device.installRuntime({ forceInstall: true });
      xrStore.setState({ emulator: device as never });
    }
    return true;
  }
  for (let i = 0; i < 30 && !xrStore.getState().emulator; i++) await new Promise((r) => setTimeout(r, 50));
  const emulator = xrStore.getState().emulator as
    | { isNativeXRAvailable?: () => boolean; installRuntime: (options?: { forceInstall?: boolean }) => void }
    | undefined;
  if (!emulator) return false;
  if (emulator.isNativeXRAvailable?.()) emulator.installRuntime({ forceInstall: true });
  return true;
}

/** Enters a mode picked in the menu. */
export async function enterMode(mode: XRMode) {
  useXRUi.setState({ entering: mode, error: null, placed: false, scale: defaultScale(mode), lastDistance: null });
  try {
    const session = mode === "vr" ? await xrStore.enterVR() : await xrStore.enterAR();
    if (!session) throw new Error("The browser didn't start the XR session");
    rememberMode(mode);
  } catch (e) {
    useXRUi.setState({ entering: null, error: e instanceof Error ? e.message : String(e) });
  }
}

export function exitXR() {
  void xrStore.getState().session?.end();
}

// Mirror the session into the UI state: the mode it really is and what it granted.
xrStore.subscribe((state, previous) => {
  if (state.session === previous.session) return;
  const session = state.session as (XRSession & { interactionMode?: string; enabledFeatures?: string[] }) | undefined;
  if (!session) {
    useXRUi.setState({ mode: null, entering: null, features: [], placed: false });
    return;
  }
  const requested = useXRUi.getState().entering ?? (state.mode === "immersive-vr" ? "vr" : "mr");
  const mode = confirmSession(requested, session);
  useXRUi.setState({
    mode,
    entering: null,
    features: [...(session.enabledFeatures ?? [])],
    // A phone that was entered as MR (or a headset as AR) gets the right profile.
    scale: mode !== requested && mode !== "vr" ? defaultScale(mode) : useXRUi.getState().scale,
  });
});

// Test hook (development builds only), like window.__bim.
if (import.meta.env.DEV) {
  void Promise.all([import("three"), import("./origin")]).then(([THREE, origin]) => {
    (window as unknown as { __xr: unknown }).__xr = { store: xrStore, ui: useXRUi, viewer: useViewer, THREE, modelBox: origin.modelBox };
  });
}
