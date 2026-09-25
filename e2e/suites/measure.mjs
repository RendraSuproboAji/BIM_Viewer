import { APP_URL, checker, enterViewer, fixture, launch, output } from "../lib.mjs";
const { results, check, finish } = checker();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const project = (points) =>
  page.evaluate((pts) => {
    const cam = window.__bimControls.camera;
    const rect = document.querySelector(".viewport canvas").getBoundingClientRect();
    cam.updateMatrixWorld();
    return pts.map((p) => {
      const v = cam.position.clone().set(...p).project(cam);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
    });
  }, points);
async function clickPoints(points, { settle = 400 } = {}) {
  for (const [x, y] of points) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(settle);
    await page.mouse.click(x, y);
  }
}
const rowText = (i) => page.locator(".measure-list .row").nth(i).innerText({ timeout: 5000 }).then((t) => t.replace(/\s+/g, " "));
const tool = (name) => page.locator(".toolbar button", { hasText: name }).click();

try {
  await page.goto(APP_URL);
  await enterViewer(page);
  await page.setInputFiles(".toolbar input[type=file]", fixture("extra/box.ifc"));
  await page.waitForSelector(".tree-model", { timeout: 60000 });
  // Let the initial framing animation finish, then set a fixed three-quarter view from above.
  await page.waitForFunction(() => window.__bimControls && !window.__bimControls.active, null, { timeout: 10000 });
  await page.waitForTimeout(1000);
  const box = await page.evaluate(async () => {
    const b = [...window.__bim.models.values()][0].box;
    const c = b.getCenter(b.min.clone());
    await window.__bimControls.setLookAt(c.x + 6, c.y + 6, c.z + 8, c.x, c.y, c.z, false);
    return { min: b.min.toArray(), max: b.max.toArray(), size: b.getSize(b.min.clone()).toArray() };
  });
  await page.waitForTimeout(1500);
  check("test box converted at 4 x 2.5 x 3 m", [4, 2.5, 3].every((v, i) => Math.abs(box.size[i] - v) < 1e-3), JSON.stringify(box.size.map((v) => +v.toFixed(3))));
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  // Corners visible from (+x, +y, +z): the top face and the two near sides.
  const topFace = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const nearEdge = [[x1, y0, z1], [x1, y1, z1]];

  // ---- Distance: the vertical edge nearest the camera is 2.5 m ------------------------------------
  await tool("Distance");
  check("measure mode shows the hint", (await page.locator(".measure-hint").innerText()).includes("Click two points"));
  await clickPoints(await project(nearEdge));
  await page.waitForTimeout(800);
  check("distance of the box edge is 2.500 m", (await rowText(0)).includes("2.500 m"), await rowText(0));
  check("3D label shows ΔX/ΔY/ΔZ", (await page.locator(".measure-label").allInnerTexts()).some((t) => t.includes("ΔZ 2.500 m")));
  check("tool stays active for the next measurement", (await page.locator(".toolbar button.active", { hasText: "Distance" }).count()) === 1);

  // Esc cancels a draft; second Esc leaves measure mode.
  await clickPoints((await project([nearEdge[0]])));
  await page.waitForTimeout(500);
  check("first click shows a point count", (await page.locator(".measure-hint").innerText()).includes("(1 point)"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Esc cancels the draft but keeps the tool", !(await page.locator(".measure-hint").innerText()).includes("point)") && (await page.locator(".measure-list .row").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("second Esc leaves measure mode", (await page.locator(".measure-hint").count()) === 0);

  // Backspace undoes the last point.
  await tool("Distance");
  const edgeScreen = await project(nearEdge);
  await clickPoints([edgeScreen[0], edgeScreen[1]].slice(0, 1));
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(500);
  check("Backspace removes the last point", !(await page.locator(".measure-hint").innerText()).includes("point)"));
  await page.keyboard.press("Escape");

  // ---- Area: 4 x 3 m top face, closed with Enter immediately after the last click -------------------
  await tool("Area");
  const topScreen = await project(topFace);
  await clickPoints(topScreen);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  check("area of the top face is 12.00 m² (Enter right after the last click)", (await rowText(1)).includes("12.00 m²"), await rowText(1));
  check("perimeter is 14.000 m", (await rowText(1)).includes("perimeter 14.000 m"));

  // Closing by clicking the first point again (triangle = half the face).
  await clickPoints([topScreen[0], topScreen[1], topScreen[2], topScreen[0]]);
  await page.waitForTimeout(1000);
  check("clicking the first point closes the polygon (6.00 m²)", (await rowText(2)).includes("6.00 m²"), await rowText(2));
  await page.keyboard.press("Escape");

  // ---- Angle at a top corner: 90° -------------------------------------------------------------------
  await tool("Angle");
  await clickPoints([topScreen[1], topScreen[2], topScreen[3]]);
  await page.waitForTimeout(1000);
  check("angle at the box corner is 90.0°", (await rowText(3)).includes("90.0°"), await rowText(3));
  // And across a diagonal: atan(3/4) ≈ 36.9°.
  await clickPoints([topScreen[1], topScreen[0], topScreen[2]]);
  await page.waitForTimeout(1000);
  check("angle between side and diagonal is 36.9°", (await rowText(4)).includes("36.9°"), await rowText(4));
  await page.screenshot({ path: output("measure-all.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // ---- Near-miss snapping: clicking 6 px outside a corner still snaps to it -------------------------------
  await tool("Distance");
  const [c0] = await project([topFace[2]]);
  const [c1] = await project([[x1, y0, z1]]);
  await clickPoints([[c0[0] + 5, c0[1] - 5], [c1[0] + 5, c1[1] + 4]]);
  await page.waitForTimeout(800);
  check("near-miss clicks snap to the corners (2.500 m)", (await rowText(5)).includes("2.500 m"), await rowText(5));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // ---- Housekeeping ---------------------------------------------------------------------------------
  check("clicks while measuring do not select elements", (await page.locator(".props").count()) === 0);
  await page.locator(".measure-list .row button").first().click();
  check("delete one measurement", (await page.locator(".measure-list .row").count()) === 5);
  await page.locator(".measure-panel button.link").click();
  check("clear all", (await page.locator(".measure-panel").count()) === 0);
  await page.mouse.click(750, 500);
  await page.waitForTimeout(1200);
  check("after leaving measure mode, clicks select again", (await page.locator(".props").count()) === 1);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  console.log("ERROR", e.message.split("\n")[0]);
  await page.screenshot({ path: output("measure-error.png") });
  results.push(false);
}
finish();
await browser.close();
