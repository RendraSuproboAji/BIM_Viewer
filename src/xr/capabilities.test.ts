import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmSession, detectXR, guessDevice, type XREnvironment } from "./capabilities";

const UA = {
  quest3: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/37.0.0 SamsungBrowser/4.0 Chrome/132.0 VR Safari/537.36",
  quest2: "Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0 Chrome/128.0 VR Safari/537.36",
  pico: "Mozilla/5.0 (Linux; Android 12; A9210 Build/SKQ1) AppleWebKit/537.36 (KHTML, like Gecko) PicoBrowser/4.0 Chrome/120 VR Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  visionPro: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
};

const xr = (vr: boolean, ar: boolean) => ({ isSessionSupported: async (m: string) => (m === "immersive-vr" ? vr : ar) });
const env = (over: Partial<XREnvironment>): XREnvironment => ({ isSecureContext: true, userAgent: UA.desktop, xr: xr(false, false), ...over });

test("Quest 3: VR and MR ready, AR points to MR", async () => {
  const c = await detectXR(env({ userAgent: UA.quest3, xr: xr(true, true) }));
  assert.equal(c.device.name, "Meta Quest 3");
  assert.equal(c.modes.vr.state, "ready");
  assert.equal(c.modes.mr.state, "ready");
  assert.equal(c.modes.ar.state, "unavailable");
  assert.match(c.modes.ar.reason!, /use MR/);
});

test("Quest 2 and Pico: MR limited with the device's caveats", async () => {
  const q2 = await detectXR(env({ userAgent: UA.quest2, xr: xr(true, true) }));
  assert.equal(q2.modes.mr.state, "limited");
  assert.match(q2.modes.mr.reason!, /greyscale/);
  const pico = await detectXR(env({ userAgent: UA.pico, xr: xr(true, true) }));
  assert.equal(pico.device.kind, "headset");
  assert.equal(pico.modes.mr.state, "limited");
});

test("Android phone: AR ready, VR and MR unavailable", async () => {
  const c = await detectXR(env({ userAgent: UA.android, mobile: true, xr: xr(false, true) }));
  assert.equal(c.device.kind, "handheld");
  assert.equal(c.modes.ar.state, "ready");
  assert.equal(c.modes.vr.state, "unavailable");
  assert.equal(c.modes.mr.state, "unavailable");
});

test("iPhone: no WebXR at all", async () => {
  const c = await detectXR(env({ userAgent: UA.iphone, xr: null }));
  for (const mode of ["vr", "ar", "mr"] as const) {
    assert.equal(c.modes[mode].state, "unavailable");
    assert.match(c.modes[mode].reason!, /iPhone\/iPad has no WebXR/);
  }
});

test("Vision Pro: VR with gaze + pinch, no immersive AR", async () => {
  const c = await detectXR(env({ userAgent: UA.visionPro, maxTouchPoints: 5, xr: xr(true, false) }));
  assert.equal(c.device.name, "Apple Vision Pro");
  assert.equal(c.modes.vr.state, "limited");
  assert.equal(c.modes.mr.state, "unavailable");
  assert.match(c.modes.mr.reason!, /Vision Pro/);
});

test("desktop with PC VR: VR only; without a headset: nothing", async () => {
  const pcvr = await detectXR(env({ xr: xr(true, false) }));
  assert.equal(pcvr.modes.vr.state, "ready");
  assert.equal(pcvr.modes.mr.state, "unavailable");
  const none = await detectXR(env({}));
  assert.equal(none.modes.vr.state, "unavailable");
  assert.match(none.modes.vr.reason!, /No VR headset/);
});

test("plain HTTP blocks every mode", async () => {
  const c = await detectXR(env({ isSecureContext: false, userAgent: UA.quest3, xr: xr(true, true) }));
  assert.ok(Object.values(c.modes).every((m) => m.state === "unavailable" && /HTTPS/.test(m.reason!)));
});

test("an unknown AR device offers AR and MR, confirmed after entering", async () => {
  const c = await detectXR(env({ xr: xr(false, true) }));
  assert.equal(c.modes.ar.state, "limited");
  assert.equal(c.modes.mr.state, "limited");
  assert.equal(confirmSession("mr", { interactionMode: "screen-space" }), "ar");
  assert.equal(confirmSession("ar", { interactionMode: "world-space" }), "mr");
  assert.equal(confirmSession("vr", { interactionMode: "world-space" }), "vr");
});

test("a failing isSessionSupported counts as unsupported", async () => {
  const c = await detectXR(env({ userAgent: UA.quest3, xr: { isSessionSupported: async () => Promise.reject(new Error("blocked")) } }));
  assert.equal(c.modes.vr.state, "unavailable");
});

test("the emulator is reported as an emulated Quest 3", () => {
  assert.equal(guessDevice({ userAgent: UA.desktop, emulated: true }).name, "Meta Quest 3 (emulated)");
});
