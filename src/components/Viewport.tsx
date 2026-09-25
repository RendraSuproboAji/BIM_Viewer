import { CameraControls, GizmoHelper, GizmoViewport, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { select } from "../bim/actions";
import { engine } from "../bim/engine";
import { useViewer } from "../bim/store";

export function Viewport() {
  return (
    <Canvas
      className="viewport"
      camera={{ position: [30, 25, 30], fov: 45, near: 0.05, far: 100000 }}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      onCreated={({ gl }) => gl.setClearColor("#1d2126")}
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[50, 80, 30]} intensity={2} />
      <Grid
        args={[500, 500]}
        cellSize={1}
        sectionSize={10}
        cellColor="#3a4048"
        sectionColor="#56606b"
        fadeDistance={1500}
        infiniteGrid
      />
      <Bim />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport labelColor="white" axisHeadScale={0.9} />
      </GizmoHelper>
    </Canvas>
  );
}

/** Bridges That Open fragments models into the R3F scene graph. */
function Bim() {
  const { scene, camera, gl } = useThree();
  const controls = useRef<CameraControls>(null);
  const models = useViewer((s) => s.models);
  const fitRequest = useViewer((s) => s.fitRequest);
  const section = useViewer((s) => s.section);

  // Add freshly loaded models to the scene and let them stream LODs for our camera.
  useEffect(() => {
    for (const { id } of models) {
      const model = engine.getModel(id);
      if (!model || model.object.parent === scene) continue;
      model.useCamera(camera as THREE.PerspectiveCamera);
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
    return () => {
      c.removeEventListener("update", onMove);
      c.removeEventListener("rest", onRest);
    };
  }, []);

  // Frame the whole scene or the selected element.
  useEffect(() => {
    if (fitRequest.n === 0) return;
    void (async () => {
      const box = new THREE.Box3();
      const { selection } = useViewer.getState();
      const target = fitRequest.target;
      if (typeof target === "object") {
        const model = engine.getModel(target.modelId);
        if (model) box.union(await model.getMergedBox(target.localIds));
      } else if (target === "selection" && selection) {
        const model = engine.getModel(selection.modelId);
        if (model) box.union(await model.getMergedBox([selection.localId]));
      } else {
        for (const model of engine.models.values()) if (model.object.visible) box.union(model.box);
      }
      if (!box.isEmpty()) await controls.current?.fitToBox(box, true, { paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 });
    })();
  }, [fitRequest]);

  // Section plane driven by the store.
  const plane = useMemo(() => new THREE.Plane(), []);
  useEffect(() => {
    const box = new THREE.Box3();
    for (const model of engine.models.values()) box.union(model.box);
    if (!section.enabled || box.isEmpty()) {
      gl.clippingPlanes = [];
    } else {
      const axisIndex = { x: 0, y: 1, z: 2 }[section.axis];
      const min = box.min.getComponent(axisIndex);
      const max = box.max.getComponent(axisIndex);
      const at = min + (max - min) * section.offset;
      const normal = new THREE.Vector3().setComponent(axisIndex, section.flipped ? 1 : -1);
      // Keeps the side the normal points to: points where normal·p + constant >= 0.
      plane.set(normal, section.flipped ? -at : at);
      gl.clippingPlanes = [plane];
    }
    for (const model of engine.models.values()) {
      model.getClippingPlanesEvent = () => gl.clippingPlanes;
    }
    void engine.update(true);
  }, [section, models, gl, plane]);

  // Click (not drag) to pick an element.
  useEffect(() => {
    const dom = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = async (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      down = null;
      const result = await engine.pick(camera as THREE.PerspectiveCamera, dom, e.clientX, e.clientY);
      await select(result ? { modelId: result.modelId, localId: result.hit.localId } : null);
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera]);

  return <CameraControls ref={controls} makeDefault />;
}
