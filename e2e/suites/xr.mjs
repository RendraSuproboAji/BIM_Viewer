// VR / MR in an emulated Meta Quest 3 (IWER, via the dev-only ?xr-automation flag):
// compatibility check, entering each mode, placement, controller selection at 1:1 and
// at 1:100, teleport, measuring, and returning to the desktop viewer.
import { APP_URL, checker, enterViewer, fixture, launch, output } from "../lib.mjs";

const { check, fail, finish } = checker();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/** Poses the right controller (tracking space) to look at a target point, then pulls a button. */
async function press(button, { from, to }) {
  await page.evaluate(
    async ({ button, from, to }) => {
      const { THREE, store } = window.__xr;
      const right = store.getState().emulator.controllers.right;
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...from), new THREE.Vector3(...to), new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      right.position.set(...from);
      right.quaternion.set(q.x, q.y, q.z, q.w);
      await new Promise((r) => setTimeout(r, 500)); // poses apply on the next frames
      right.updateButtonValue(button, 1);
      await new Promise((r) => setTimeout(r, 300));
      right.updateButtonValue(button, 0);
      await new Promise((r) => setTimeout(r, 1200));
    },
    { button, from, to },
  );
}

/** A model point in the user's tracking space (where to aim the controller). */
const toTracking = (point) =>
  page.evaluate((p) => {
    const { THREE, store } = window.__xr;
    const origin = store.getState().origin;
    origin.updateMatrixWorld(true);
    return new THREE.Vector3(...p).applyMatrix4(origin.matrixWorld.clone().invert()).toArray();
  }, point);

/** The largest floor slab: its id and the centre of its top face (model space). */
const floorSlab = () =>
  page.evaluate(async () => {
    const model = [...window.__bim.models.values()][0];
    const ids = Object.values(await model.getItemsOfCategories([/^IFCSLAB$/])).flat();
    const boxes = await model.getBoxes(ids);
    let best = 0;
    boxes.forEach((b, i) => {
      const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
      const bestArea = (boxes[best].max.x - boxes[best].min.x) * (boxes[best].max.z - boxes[best].min.z);
      if (area > bestArea) best = i;
    });
    const b = boxes[best];
    return { id: ids[best], top: [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2] };
  });

/** Controller at `height` model-metres above a model point, pointing straight down at it. */
async function pointDownAt(button, point, height) {
  const target = await toTracking(point);
  const from = await toTracking([point[0], point[1] + height, point[2]]);
  await press(button, { from, to: target });
}

const originState = () =>
  page.evaluate(() => {
    const o = window.__xr.store.getState().origin;
    return { position: o.position.toArray(), scale: o.scale.x };
  });
const selection = () => page.evaluate(() => window.__xr.viewer.getState().selection);

try {
  await page.goto(`${APP_URL}?xr-automation`);
  await enterViewer(page);
  await page.setInputFiles(".toolbar input[type=file]", fixture("ifc/Building-Architecture-ifc4.ifc"));
  await page.waitForSelector(".tree-model", { timeout: 120000 });
  await page.waitForTimeout(1000);

  // ---- Compatibility check and mode picker ----------------------------------------------------
  await page.click(".xr-menu > button");
  await page.waitForFunction(() => document.querySelectorAll(".xr-mode:not(.xr-checking)").length === 3 && window.__xr?.ui.getState().layerReady, null, { timeout: 30000 });
  const modes = Object.fromEntries(
    await page.locator(".xr-mode").evaluateAll((els) => els.map((e) => [e.querySelector(".xr-mode-name").textContent.trim().split(" ").pop(), { cls: e.className, text: e.textContent, disabled: e.disabled }])),
  );
  check("the device is detected (emulated Quest 3)", (await page.locator(".xr-dropdown-head .muted").innerText()).includes("Quest 3"));
  check("VR and MR are ready", modes.VR.cls.includes("xr-ready") && modes.MR.cls.includes("xr-ready") && !modes.VR.disabled && !modes.MR.disabled);
  check("AR is unavailable on a headset, with the reason", modes.AR.disabled && /use MR/.test(modes.AR.text));
  await page.click(".xr-dropdown button:has-text('compatibility details')");
  check("the compatibility report lists devices", (await page.locator(".xr-report").innerText()).includes("Meta Quest 3 / 3S"));

  // ---- VR -------------------------------------------------------------------------------------
  await page.locator(".xr-mode", { has: page.locator(".xr-mode-name", { hasText: /VR$/ }) }).click();
  await page.waitForFunction(() => window.__xr.ui.getState().mode === "vr", null, { timeout: 20000 });
  const features = await page.evaluate(() => window.__xr.ui.getState().features);
  check("VR session starts and reports its features", features.includes("local-floor"), JSON.stringify(features));
  await page.waitForTimeout(1500);
  const box = await page.evaluate(async () => {
    const b = await window.__xr.modelBox();
    return { min: b.min.toArray(), max: b.max.toArray() };
  });
  const slab = await floorSlab();
  const start = await originState();
  check("VR starts at 1:1 on the ground, 4 m in front of the model", start.scale === 1 && Math.abs(start.position[2] - (box.max[2] + 4)) < 1e-6 && Math.abs(start.position[1] - box.min[1]) < 1e-6, JSON.stringify(start));
  check("the in-headset panel is in the scene", await page.evaluate(() => !!window.__xr.store.getState().origin.getObjectByName("xr-panel")));
  check("the desktop camera controls are off in XR", await page.evaluate(() => !window.__bimControls.enabled));

  // Select the floor slab with the controller, pointing down at it from inside the room.
  await pointDownAt("trigger", slab.top, 1.4);
  const picked = await selection();
  check("controller trigger selects the element it points at", picked?.localId === slab.id, `${JSON.stringify(picked)} vs slab ${slab.id}`);

  // Measure: two points 1 m apart on the slab.
  await page.evaluate(() => window.__xr.viewer.getState().setTool("distance"));
  await pointDownAt("trigger", [slab.top[0] - 0.5, slab.top[1], slab.top[2]], 1.4);
  await pointDownAt("trigger", [slab.top[0] + 0.5, slab.top[1], slab.top[2]], 1.4);
  const measured = await page.evaluate(() => ({ n: window.__xr.viewer.getState().measurements.length, last: window.__xr.ui.getState().lastDistance }));
  check("two controller points measure a distance (1 m, snapped)", measured.n === 1 && Math.abs(measured.last - 1) < 0.25, JSON.stringify(measured));
  await page.evaluate(() => window.__xr.viewer.getState().setTool("select"));

  // Teleport: grip while pointing at the floor slab.
  const before = await originState();
  await pointDownAt("squeeze", slab.top, 1.4);
  const after = await originState();
  const feet = await page.evaluate(() => {
    const { THREE, store } = window.__xr;
    const o = store.getState().origin;
    o.updateMatrixWorld(true);
    return new THREE.Vector3(0, 0, 0).applyMatrix4(o.matrixWorld).toArray();
  });
  check("grip teleports onto the floor", Math.abs(feet[1] - slab.top[1]) < 0.05 && Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2]) > 1, `feet ${feet.map((v) => v.toFixed(2))}, slab top y ${slab.top[1].toFixed(2)}`);

  // Overview: 1:50 makes the user 50× larger.
  await page.evaluate(() => window.__xr.ui.setState({ scale: 1 / 50 }));
  await page.waitForTimeout(800);
  check("the 1:50 overview scales the user, not the model", Math.abs((await originState()).scale - 50) < 1e-6);
  await page.evaluate(() => window.__xr.ui.setState({ scale: 1 }));

  // Section still works in VR.
  await page.evaluate(() => window.__xr.viewer.getState().setSection({ enabled: true, axis: "y", offset: 0.3 }));
  await page.waitForTimeout(500);
  check("section planes apply in VR", await page.evaluate(() => window.__bim.getClippingPlanes().length === 1));
  await page.evaluate(() => window.__xr.viewer.getState().setSection({ enabled: false }));
  await page.screenshot({ path: output("xr-vr.png") });

  await page.evaluate(() => window.__xr.store.getState().session.end());
  await page.waitForFunction(() => window.__xr.ui.getState().mode === null, null, { timeout: 10000 });
  check("exiting VR restores the desktop camera controls", await page.evaluate(() => window.__bimControls.enabled));

  // ---- MR (passthrough) -------------------------------------------------------------------------
  await page.click(".xr-menu > button");
  await page.waitForSelector(".xr-mode.xr-ready", { timeout: 10000 });
  await page.locator(".xr-mode", { has: page.locator(".xr-mode-name", { hasText: /MR$/ }) }).click();
  await page.waitForFunction(() => window.__xr.ui.getState().mode === "mr", null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const preview = await originState();
  check("MR shows a 1:100 table-top preview", Math.abs(preview.scale - 100) < 1e-6 && !(await page.evaluate(() => window.__xr.ui.getState().placed)), JSON.stringify(preview));
  // Place: select confirms the preview (the emulator has no real surfaces to hit-test).
  await press("trigger", { from: [0.25, 1.4, -0.3], to: [0, 0.8, -0.8] });
  check("select places the model", await page.evaluate(() => window.__xr.ui.getState().placed));

  // Select the slab on the 1:100 model: from 1.4 model-metres (14 mm real) above it.
  await page.evaluate(() => window.__xr.viewer.getState().setTool("select"));
  await page.evaluate(async () => {
    const { select } = await import("/src/bim/actions.ts");
    await select(null);
  });
  await pointDownAt("trigger", slab.top, 1.4);
  const mrPicked = await selection();
  check("controller selects on the scaled 1:100 model", mrPicked?.localId === slab.id, `${JSON.stringify(mrPicked)} vs slab ${slab.id}`);
  await page.screenshot({ path: output("xr-mr.png") });

  // Changing the scale keeps the model at the placed spot.
  const placedAt = await toTracking([(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2]);
  await page.evaluate(() => window.__xr.ui.setState({ scale: 1 / 50 }));
  await page.waitForTimeout(800);
  const placedAt50 = await toTracking([(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2]);
  check("rescaling keeps the model where it was placed", Math.hypot(...placedAt.map((v, i) => v - placedAt50[i])) < 0.01, `${placedAt.map((v) => v.toFixed(3))} vs ${placedAt50.map((v) => v.toFixed(3))}`);

  await page.evaluate(() => window.__xr.store.getState().session.end());
  await page.waitForFunction(() => window.__xr.ui.getState().mode === null, null, { timeout: 10000 });

  // ---- Back on the desktop --------------------------------------------------------------------
  await page.click("text=Fit all");
  await page.waitForTimeout(1500);
  const canvas = await page.locator(".viewport canvas").boundingBox();
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.waitForTimeout(1500);
  check("the desktop viewer works after XR (click selects)", !!(await selection()));
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  fail(e);
  await page.screenshot({ path: output("xr-error.png") }).catch(() => {});
} finally {
  finish();
  await browser.close();
}
