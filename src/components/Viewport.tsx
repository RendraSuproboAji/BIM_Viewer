import { CameraControls, GizmoHelper, GizmoViewport, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { select } from "../bim/actions";
import { registerControls, registerRenderer } from "../bim/camera";
import { REQUIRED_POINTS, type Point, type SnapKind } from "../bim/measure";
import { engine } from "../bim/engine";
import { framingBox } from "../bim/framing";
import { useViewer } from "../bim/store";
import { useXRUi } from "../xr/state";
import { MeasurementOverlay } from "./Measurements";

/** VR/AR/MR support, loaded only once the user opens the XR menu (see src/xr/). */
const XRLayer = lazy(() => import("../xr/XRLayer"));

export function Viewport() {
  const xrRequested = useXRUi((s) => s.runtimeLoaded);
  return (
    <Canvas
      className="viewport"
      camera={{ position: [30, 25, 30], fov: 45, near: 0.05, far: 100000 }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      // Draw only when something changes (camera, streamed geometry, edits), not 60× a second.
      // (XR sessions render every headset frame regardless.)
      frameloop="demand"
      onCreated={({ gl }) => gl.setClearColor("#1d2126")}
    >
      {xrRequested ? (
        <Suspense fallback={<Scene />}>
          <XRLayer>
            <Scene />
          </XRLayer>
        </Suspense>
      ) : (
        <Scene />
      )}
    </Canvas>
  );
}

function Scene() {
  const xrMode = useXRUi((s) => s.mode);
  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[50, 80, 30]} intensity={2} />
      {/* In AR and MR the real world is the floor. */}
      {xrMode !== "ar" && xrMode !== "mr" && (
        <Grid
          args={[500, 500]}
          cellSize={1}
          sectionSize={10}
          cellColor="#3a4048"
          sectionColor="#56606b"
          fadeDistance={1500}
          infiniteGrid
          pointerEvents="none"
        />
      )}
      <Bim />
      {!xrMode && (
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
      )}
    </>
  );
}

/** Bridges That Open fragments models into the R3F scene graph. */
function Bim() {
  const { scene, camera, gl, invalidate } = useThree();
  const controls = useRef<CameraControls>(null);
  const framedOnce = useRef(false);
  const models = useViewer((s) => s.models);
  const fitRequest = useViewer((s) => s.fitRequest);
  const section = useViewer((s) => s.section);

  useEffect(() => {
    engine.setRenderRequester(() => invalidate());
    return () => engine.setRenderRequester(null);
  }, [invalidate]);

  // Add freshly loaded models to the scene and let them stream LODs for our camera.
  useEffect(() => {
    for (const { id } of models) {
      const model = engine.getModel(id);
      if (!model || model.object.parent === scene) continue;
      model.useCamera(camera as THREE.PerspectiveCamera);
      // BIM picking goes through the fragments raycast (engine.pick/pickRay); keep XR
      // pointers from raycasting the model meshes every frame.
      (model.object as THREE.Object3D & { pointerEvents?: string }).pointerEvents = "none";
      scene.add(model.object);
    }
    // Remove objects of disposed models.
    const ids = new Set(models.map((m) => m.id));
    for (const child of [...scene.children]) {
      if (child.userData.bimModelId && !ids.has(child.userData.bimModelId)) scene.remove(child);
    }
    for (const { id } of models) {
      const model = engine.getModel(id);
      if (model) model.object.userData.bimModelId = id;
    }
    void engine.update(true);
  }, [models, scene, camera]);

  // Keep fragments streaming in sync with camera movement.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onMove = () => void engine.update();
    const onRest = () => void engine.update(true);
    c.addEventListener("update", onMove);
    c.addEventListener("rest", onRest);
    registerControls(c);
    registerRenderer({ gl, scene, camera });
    return () => {
      registerRenderer(null);
      c.removeEventListener("update", onMove);
      c.removeEventListener("rest", onRest);
      registerControls(null);
    };
  }, [gl, scene, camera]);

  // Frame the whole scene or the selected element.
  useEffect(() => {
    if (fitRequest.n === 0) return;
    void (async () => {
      const box = new THREE.Box3();
      const { selection } = useViewer.getState();
      const target = fitRequest.target;
      if (typeof target === "object" && "box" in target) {
        box.set(new THREE.Vector3(...target.box[0]), new THREE.Vector3(...target.box[1]));
      } else if (typeof target === "object") {
        const model = engine.getModel(target.modelId);
        if (model) box.union(await model.getMergedBox(target.localIds));
      } else if (target === "selection" && selection) {
        const model = engine.getModel(selection.modelId);
        if (model) {
          box.union(await model.getMergedBox([selection.localId]));
          // Spatial elements (storeys, buildings) have no geometry: frame their contents.
          if (box.isEmpty()) {
            const children = await model.getItemsChildren([selection.localId]);
            if (children.length) box.union(await model.getMergedBox(children));
          }
        }
      } else {
        // Frame the visible elements, ignoring stray markers far from the building.
        const boxes: THREE.Box3[] = [];
        for (const model of engine.models.values()) {
          if (model.object.visible) boxes.push(...(await model.getBoxes(await model.getItemsByVisibility(true))));
        }
        box.copy(framingBox(boxes));
      }
      const c = controls.current;
      if (box.isEmpty() || !c) return;
      // The first model gets a three-quarter view; afterwards the user's viewing angle is kept
      // (fitToBox would snap the camera to the nearest axis-aligned side, flattening the view).
      if (!framedOnce.current) {
        framedOnce.current = true;
        await c.rotateTo(Math.PI / 4, Math.PI / 3, false);
      }
      await c.fitToSphere(box.getBoundingSphere(new THREE.Sphere()), true);
    })();
  }, [fitRequest]);

  // Section plane driven by the store. Applied to fragments materials only
  // (local clipping), so the grid and axis gizmo are never cut.
  const plane = useMemo(() => new THREE.Plane(), []);
  useEffect(() => {
    gl.localClippingEnabled = true;
    const box = new THREE.Box3();
    for (const model of engine.models.values()) box.union(model.box);
    if (!section.enabled || box.isEmpty()) {
      engine.setClippingPlanes([]);
    } else {
      const axisIndex = { x: 0, y: 1, z: 2 }[section.axis];
      const min = box.min.getComponent(axisIndex);
      const max = box.max.getComponent(axisIndex);
      const at = min + (max - min) * section.offset;
      const normal = new THREE.Vector3().setComponent(axisIndex, section.flipped ? 1 : -1);
      // Keeps the side the normal points to: points where normal·p + constant >= 0.
      plane.set(normal, section.flipped ? -at : at);
      engine.setClippingPlanes([plane]);
    }
    void engine.update(true);
  }, [section, models, gl, plane]);

  // Measurement: snapped hover marker, click to place points, keyboard shortcuts.
  const tool = useViewer((s) => s.tool);
  const [hover, setHover] = useState<{ point: Point; kind: SnapKind } | null>(null);
  useEffect(() => {
    if (tool === "select") {
      setHover(null);
      return;
    }
    const dom = gl.domElement;
    let pending: PointerEvent | null = null;
    let busy = false;
    const flush = async () => {
      if (busy || !pending) return;
      busy = true;
      const e = pending;
      pending = null;
      setHover(await engine.snap(camera as THREE.PerspectiveCamera, dom, e.clientX, e.clientY));
      busy = false;
      if (pending) void flush();
    };
    // Snap raycasts are async; only the latest pointer position is processed.
    const onMove = (e: PointerEvent) => {
      pending = e;
      void flush();
    };
    const onLeave = () => setHover(null);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (!["Escape", "Backspace", "Enter"].includes(e.key)) return;
      if (e.key === "Backspace") e.preventDefault();
      // Queued behind pending clicks, whose snap raycasts are still resolving.
      enqueueMeasure(() => {
        const { draft, setDraft, setTool } = useViewer.getState();
        if (e.key === "Escape") {
          if (draft.length) setDraft([]);
          else setTool("select");
        } else if (e.key === "Backspace" && draft.length) {
          setDraft(draft.slice(0, -1));
        } else if (e.key === "Enter" && tool === "area" && draft.length >= 3) {
          finish(draft);
        }
      });
    };
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onKey);
    dom.style.cursor = "crosshair";
    return () => {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      dom.style.cursor = "";
    };
  }, [tool, gl, camera]);

  // Measurement clicks and keys are processed strictly in order.
  const measureQueue = useRef<Promise<unknown>>(Promise.resolve());
  function enqueueMeasure(step: () => unknown) {
    measureQueue.current = measureQueue.current.then(step).catch(() => {});
    return measureQueue.current;
  }

  function finish(points: Point[]) {
    const { tool: current, addMeasurement } = useViewer.getState();
    if (current !== "select") addMeasurement({ kind: current, points });
  }

  async function addMeasurePoint(clientX: number, clientY: number) {
    const { tool: current, draft, setDraft } = useViewer.getState();
    if (current === "select") return;
    const snap = await engine.snap(camera as THREE.PerspectiveCamera, gl.domElement, clientX, clientY);
    if (!snap) return;
    if (current === "area" && draft.length >= 3 && nearOnScreen(draft[0], clientX, clientY)) return finish(draft);
    const next = [...draft, snap.point];
    if (current !== "area" && next.length >= REQUIRED_POINTS[current]) finish(next);
    else setDraft(next);
  }

  /** Whether a 3D point projects within a few pixels of the cursor (closing an area polygon). */
  function nearOnScreen(point: Point, clientX: number, clientY: number) {
    const rect = gl.domElement.getBoundingClientRect();
    const p = new THREE.Vector3(...point).project(camera);
    const x = rect.left + ((p.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - p.y) / 2) * rect.height;
    return Math.hypot(x - clientX, y - clientY) < 12;
  }

  // Click (not drag) to pick an element, or to place a measurement point.
  useEffect(() => {
    const dom = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = async (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      down = null;
      if (useViewer.getState().tool !== "select") {
        const { clientX, clientY } = e;
        return enqueueMeasure(() => addMeasurePoint(clientX, clientY));
      }
      const result = await engine.pick(camera as THREE.PerspectiveCamera, dom, e.clientX, e.clientY);
      await select(result ? { modelId: result.modelId, localId: result.hit.localId } : null);
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
    };
    // addMeasurePoint only reads current state from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  const inXR = useXRUi((s) => s.mode) !== null;
  return (
    <>
      {/* The headset owns the camera during an XR session. */}
      <CameraControls ref={controls} makeDefault enabled={!inXR} />
      <MeasurementOverlay hover={hover} />
    </>
  );
}
