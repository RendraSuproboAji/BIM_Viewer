/**
 * XR hardware compatibility check, run before the user picks VR, AR or MR.
 *
 * WebXR only answers "is immersive-vr / immersive-ar supported?" before a
 * session starts. Whether an AR-capable device is a headset (MR: passthrough,
 * hands) or a phone (AR: camera view, touch, DOM overlay) is guessed from the
 * browser here and confirmed once a session runs (`confirmSession`).
 *
 * No XR library is imported here, so the check is cheap to run from the toolbar.
 */

export type XRMode = "vr" | "ar" | "mr";
export const XR_MODES: XRMode[] = ["vr", "ar", "mr"];

export const MODE_LABELS: Record<XRMode, string> = {
  vr: "VR",
  ar: "AR",
  mr: "MR",
};

export const MODE_DESCRIPTIONS: Record<XRMode, string> = {
  vr: "Virtual reality: walk through the model at 1:1 in a headset.",
  ar: "Augmented reality: place the model in your phone's camera view.",
  mr: "Mixed reality: the model in your real room, seen through the headset (passthrough).",
};

export type DeviceKind = "headset" | "handheld" | "desktop" | "unknown";

export interface DeviceGuess {
  kind: DeviceKind;
  name: string;
  /** Known limitations for this device, shown in the report. */
  notes: string[];
}

export type ModeState = "ready" | "limited" | "unavailable";

export interface ModeStatus {
  state: ModeState;
  /** Why the mode can't be used (unavailable) or what's missing (limited). */
  reason?: string;
}

export interface XRCapabilities {
  secure: boolean;
  webxr: boolean;
  immersiveVr: boolean;
  immersiveAr: boolean;
  /** The IWER emulator (development builds without a headset). */
  emulated: boolean;
  device: DeviceGuess;
  modes: Record<XRMode, ModeStatus>;
}

/** What detectXR needs from the browser; injectable for tests. */
export interface XREnvironment {
  isSecureContext: boolean;
  xr?: { isSessionSupported(mode: "immersive-vr" | "immersive-ar"): Promise<boolean> } | null;
  userAgent: string;
  /** navigator.userAgentData.mobile, where available. */
  mobile?: boolean;
  maxTouchPoints?: number;
  emulated?: boolean;
}

/** Guesses the device from the browser. Headsets expose themselves in their browser's user agent. */
export function guessDevice(env: Pick<XREnvironment, "userAgent" | "mobile" | "maxTouchPoints" | "emulated" | "xr">): DeviceGuess {
  const ua = env.userAgent;
  if (env.emulated) return { kind: "headset", name: "Meta Quest 3 (emulated)", notes: ["Development emulator (IWER): no real passthrough or tracking."] };
  if (/OculusBrowser|Meta Quest|MetaQuest/i.test(ua)) {
    if (/Quest 3S/i.test(ua)) return { kind: "headset", name: "Meta Quest 3S", notes: ["No depth sensor: occlusion is skipped."] };
    if (/Quest 3/i.test(ua)) return { kind: "headset", name: "Meta Quest 3", notes: [] };
    if (/Quest Pro/i.test(ua)) return { kind: "headset", name: "Meta Quest Pro", notes: ["No depth sensing: occlusion is skipped."] };
    if (/Quest 2/i.test(ua)) return { kind: "headset", name: "Meta Quest 2", notes: ["Passthrough is greyscale.", "No depth sensing: occlusion is skipped."] };
    return { kind: "headset", name: "Meta Quest", notes: [] };
  }
  if (/Pico/i.test(ua)) return { kind: "headset", name: "Pico", notes: ["Plane detection, hit-test and anchors may be partial."] };
  if (/Android/i.test(ua) && (/Mobile/i.test(ua) || env.mobile)) return { kind: "handheld", name: "Android phone", notes: [] };
  if (/Android/i.test(ua)) return { kind: "handheld", name: "Android tablet", notes: [] };
  if (/iPhone|iPad|iPod/i.test(ua)) return { kind: "handheld", name: /iPad/.test(ua) ? "iPad" : "iPhone", notes: ["Safari on iOS has no WebXR."] };
  // Vision Pro's Safari reports itself as a Mac; unlike a Mac it has touch points and WebXR.
  if (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 0 && env.xr) {
    return { kind: "headset", name: "Apple Vision Pro", notes: ["Safari supports VR only (no immersive AR).", "Input is gaze + pinch."] };
  }
  if (env.mobile) return { kind: "handheld", name: "Mobile device", notes: [] };
  return { kind: "desktop", name: "Desktop browser", notes: [] };
}

async function supported(env: XREnvironment, mode: "immersive-vr" | "immersive-ar") {
  try {
    return (await env.xr?.isSessionSupported(mode)) ?? false;
  } catch {
    return false;
  }
}

/** Checks what this browser and device can do, per mode. */
export async function detectXR(env: XREnvironment): Promise<XRCapabilities> {
  const device = guessDevice(env);
  const base = { secure: env.isSecureContext, webxr: !!env.xr, emulated: !!env.emulated, device };
  const all = (reason: string): Record<XRMode, ModeStatus> => ({
    vr: { state: "unavailable", reason },
    ar: { state: "unavailable", reason },
    mr: { state: "unavailable", reason },
  });
  if (!env.isSecureContext) {
    return { ...base, immersiveVr: false, immersiveAr: false, modes: all("WebXR needs HTTPS: open the viewer over https://") };
  }
  if (!env.xr) {
    const reason = /iPhone|iPad|iPod/i.test(env.userAgent)
      ? "Safari on iPhone/iPad has no WebXR"
      : "This browser has no WebXR (use Meta Quest Browser, Chrome on Android, or Chrome/Edge with a PC VR headset)";
    return { ...base, immersiveVr: false, immersiveAr: false, modes: all(reason) };
  }
  const [immersiveVr, immersiveAr] = await Promise.all([supported(env, "immersive-vr"), supported(env, "immersive-ar")]);
  const kind = device.kind;
  const limited = (notes: string[]): ModeStatus => (notes.length ? { state: "limited", reason: notes.join(" ") } : { state: "ready" });

  const vr: ModeStatus = immersiveVr
    ? limited(device.name === "Apple Vision Pro" ? ["Gaze + pinch input; no thumbstick locomotion."] : [])
    : { state: "unavailable", reason: kind === "handheld" ? "Phones don't support immersive VR here" : "No VR headset found (connect one, or open the viewer in the headset's browser)" };

  let mr: ModeStatus;
  let ar: ModeStatus;
  if (!immersiveAr) {
    mr = { state: "unavailable", reason: device.name === "Apple Vision Pro" ? "Safari on Vision Pro has no immersive AR" : "This device has no passthrough AR" };
    ar = { state: "unavailable", reason: kind === "handheld" ? "This phone has no WebXR AR (needs ARCore and Chrome)" : "No AR device found" };
  } else if (kind === "handheld") {
    ar = { state: "ready" };
    mr = { state: "unavailable", reason: "This is a handheld device: use AR" };
  } else if (kind === "headset") {
    mr = limited(device.notes.filter((n) => !/emulator/i.test(n)));
    ar = { state: "unavailable", reason: "On a headset, use MR" };
  } else {
    // AR supported but the device can't be told from the browser: offer both, confirm after entering.
    const unsure = "Device type is confirmed after entering.";
    mr = { state: "limited", reason: unsure };
    ar = { state: "limited", reason: unsure };
  }
  return { ...base, immersiveVr, immersiveAr, modes: { vr, ar, mr } };
}

/** The browser's environment for detectXR. */
export function browserEnvironment(emulated = false): XREnvironment {
  const nav = navigator as Navigator & { xr?: XREnvironment["xr"]; userAgentData?: { mobile?: boolean } };
  return {
    isSecureContext: window.isSecureContext,
    xr: nav.xr ?? null,
    userAgent: nav.userAgent,
    mobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints,
    emulated,
  };
}

/**
 * The mode a running session really is: `interactionMode` tells a phone
 * ("screen-space") from a headset ("world-space"). VR stays VR.
 */
export function confirmSession(requested: XRMode, session: { interactionMode?: string; environmentBlendMode?: string }): XRMode {
  if (requested === "vr") return "vr";
  if (session.interactionMode === "screen-space") return "ar";
  if (session.interactionMode === "world-space") return "mr";
  return requested;
}

/** Optional features each mode asks for; granted ones are reported by the session. */
export const MODE_FEATURES: Record<XRMode, string[]> = {
  vr: ["hand-tracking", "layers"],
  ar: ["hit-test", "anchors", "dom-overlay", "depth-sensing"],
  mr: ["hand-tracking", "hit-test", "anchors", "plane-detection", "mesh-detection", "depth-sensing", "layers"],
};

/** Expected support by device (documentation; the runtime check is authoritative). */
export const DEVICE_SUPPORT: { device: string; vr: boolean; ar: boolean; mr: boolean; note: string }[] = [
  { device: "Meta Quest 3 / 3S", vr: true, ar: false, mr: true, note: "Primary target: colour passthrough, hands, planes, mesh, anchors, depth (Quest 3)" },
  { device: "Meta Quest Pro", vr: true, ar: false, mr: true, note: "Colour passthrough, no depth sensing" },
  { device: "Meta Quest 2", vr: true, ar: false, mr: true, note: "Greyscale passthrough, no depth sensing" },
  { device: "Pico 4 / 4 Ultra", vr: true, ar: false, mr: true, note: "Passthrough (best on 4 Ultra); planes/anchors partial" },
  { device: "Apple Vision Pro", vr: true, ar: false, mr: false, note: "Safari: VR only, gaze + pinch" },
  { device: "Android phone (ARCore, Chrome)", vr: false, ar: true, mr: false, note: "Hit-test, anchors, DOM overlay" },
  { device: "iPhone / iPad (Safari)", vr: false, ar: false, mr: false, note: "No WebXR" },
  { device: "PC VR (SteamVR/OpenXR, Quest Link) in Chrome/Edge", vr: true, ar: false, mr: false, note: "Controllers" },
];
