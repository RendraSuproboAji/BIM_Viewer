import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useXR, useXRControllerLocomotion, XR, XRDomOverlay, XROrigin } from "@react-three/xr";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { engine } from "../bim/engine";
import { setPlacementHandler } from "./actions";
import { ARControls } from "./ARControls";
import { footprintAnchor } from "./placement";
import { currentOriginScale, headInTrackingSpace, modelBox, place, placeInFront, placeWalkthroughStart, registerOrigin, rescale, resetPlacement } from "./origin";
import { xrStore } from "./runtime";
import { useXRUi } from "./state";
import { SessionInput } from "./SessionInput";
import { XRPanel } from "./XRPanel";

/**
 * Wraps the 3D scene in <XR>. Loaded on demand (see ./runtime.ts); outside a
 * session it renders the scene exactly as before.
 */
export default function XRLayer({ children }: { children: ReactNode }) {
  const mode = useXRUi((s) => s.mode);
  useEffect(() => {
    useXRUi.setState({ layerReady: true });
    return () => useXRUi.setState({ layerReady: false });
  }, []);
  return (
    <XR store={xrStore}>
      {children}
      <XROrigin ref={registerOrigin}>{mode && mode !== "ar" && <XRPanel />}</XROrigin>
      {mode && <SessionSetup />}
      {mode && <SessionInput />}
      {mode === "vr" && <VRLocomotion />}
      {(mode === "ar" || mode === "mr") && <Placement />}
      {mode === "ar" && (
        <XRDomOverlay className="xr-overlay">
          <ARControls />
        </XRDomOverlay>
      )}
    </XR>
  );
}

/** Per-session setup: start pose, transparent background in AR/MR, fragments streaming. */
function SessionSetup() {
  const mode = useXRUi((s) => s.mode)!;
  const scale = useXRUi((s) => s.scale);
  const homeRequest = useXRUi((s) => s.homeRequest);
  const { gl, camera } = useThree();

  // Passthrough (MR) and the camera view (AR) show through a transparent background.
  useEffect(() => {
    if (mode === "vr") return;
    const previous = gl.getClearAlpha();
    gl.setClearAlpha(0);
    return () => gl.setClearAlpha(previous);
  }, [gl, mode]);

  // Start pose when entering and on "home" (VR) / "re-place" previews (AR/MR).
  useEffect(() => {
    resetPlacement();
    if (mode === "vr") void placeWalkthroughStart();
    else void placeInFront(camera, useXRUi.getState().scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, homeRequest]);

  // Scale changes: VR switches between the 1:1 walkthrough and a table-top overview;
  // AR/MR keep the model where it was placed.
  const firstScale = useRef(true);
  useEffect(() => {
    if (firstScale.current) {
      firstScale.current = false;
      return;
    }
    if (mode === "vr") void (scale === 1 ? placeWalkthroughStart() : placeInFront(camera, scale, { distance: 0.6 }));
    else if (!rescale(scale)) void placeInFront(camera, scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // The camera no longer fires CameraControls events: stream fragments when the head moves.
  const last = useRef({ position: new THREE.Vector3(Infinity, 0, 0), quaternion: new THREE.Quaternion(), time: 0 });
  useFrame(() => {
    const now = performance.now();
    if (now - last.current.time < 250) return;
    const position = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(camera.matrixWorld);
    const moved = position.distanceTo(last.current.position) > 0.2 * currentOriginScale();
    const turned = quaternion.angleTo(last.current.quaternion) > THREE.MathUtils.degToRad(10);
    if (!moved && !turned) return;
    last.current = { position, quaternion, time: now };
    void engine.update();
  });
  return null;
}

/** VR thumbsticks: left moves, right snap-turns. */
function VRLocomotion() {
  // A stable ref that always reads the session's origin object.
  const origin = useMemo(() => ({ get current() { return xrStore.getState().origin ?? null; } }), []);
  useXRControllerLocomotion(origin, { speed: 1.5 }, { type: "snap", degrees: 30 });
  return null;
}

/**
 * AR/MR: a reticle where the view (headset gaze or phone screen centre) meets a
 * real surface; select places the model there, at the chosen scale, anchored.
 * Without hit-test (not granted, or unsupported), select keeps the preview.
 */
function Placement() {
  const placed = useXRUi((s) => s.placed);
  const placeRequest = useXRUi((s) => s.placeRequest);
  const camera = useThree((s) => s.camera);
  const session = useXR((s) => s.session);
  const reticle = useRef<THREE.Mesh>(null);
  const hit = useRef<{ tracking: THREE.Vector3; result: XRHitTestResult } | null>(null);
  const anchor = useRef<{ anchor: XRAnchor; modelPoint: THREE.Vector3; yaw: number; last: THREE.Vector3 } | null>(null);
  const [source, setSource] = useState<XRHitTestSource | null>(null);

  // A new placement request restarts placing.
  useEffect(() => {
    if (placeRequest) useXRUi.setState({ placed: false });
  }, [placeRequest]);

  // Hit-test from the viewer: where the headset looks, or the phone screen's centre.
  useEffect(() => {
    if (!session?.requestHitTestSource) return;
    let cancelled = false;
    let created: XRHitTestSource | undefined;
    session
      .requestReferenceSpace("viewer")
      .then((space) => session.requestHitTestSource!({ space }))
      .then((s) => {
        if (!s || cancelled) return s?.cancel();
        created = s;
        setSource(s);
      })
      .catch(() => {
        // No hit-test here: placing keeps the preview in front of the user.
      });
    return () => {
      cancelled = true;
      created?.cancel();
      setSource(null);
    };
  }, [session]);

  useEffect(() => {
    if (placed) {
      setPlacementHandler(null);
      return;
    }
    setPlacementHandler(() => {
      const current = hit.current;
      if (!current) {
        // No surface found (or no hit-test): keep the model where the preview shows it.
        useXRUi.setState({ placed: true });
        return true;
      }
      const { yaw } = headInTrackingSpace(camera);
      void (async () => {
        const modelPoint = footprintAnchor(await modelBox());
        const tracking = current.tracking.clone();
        place(modelPoint, tracking, useXRUi.getState().scale, yaw);
        useXRUi.setState({ placed: true });
        // Anchor it, so the model stays put when tracking recentres.
        const created = await current.result.createAnchor?.().catch(() => undefined);
        anchor.current = created ? { anchor: created, modelPoint, yaw, last: tracking } : null;
      })();
      return true;
    });
    return () => setPlacementHandler(null);
  }, [placed, camera]);

  // Each frame: the hit and reticle while placing, then follow the anchor.
  useFrame((state) => {
    const frame = state.gl.xr.getFrame();
    const space = xrStore.getState().originReferenceSpace;
    if (!placed && source && frame && space) {
      const results = frame.getHitTestResults(source);
      const p = results[0]?.getPose(space)?.transform.position;
      hit.current = p ? { tracking: new THREE.Vector3(p.x, p.y, p.z), result: results[0] } : null;
    }
    if (reticle.current) {
      const current = !placed ? hit.current : null;
      reticle.current.visible = !!current;
      if (current) reticle.current.position.copy(current.tracking);
    }
    const a = anchor.current;
    if (!a || !placed || !frame || !space) return;
    const pose = frame.getPose(a.anchor.anchorSpace, space);
    if (!pose) return;
    const p = pose.transform.position;
    const tracking = new THREE.Vector3(p.x, p.y, p.z);
    if (tracking.distanceTo(a.last) < 0.005) return;
    a.last = tracking;
    place(a.modelPoint, tracking, useXRUi.getState().scale, a.yaw);
  });

  useEffect(() => () => anchor.current?.anchor.delete(), []);

  // The reticle lives in tracking space (inside the XR origin): real size, at the real surface.
  const origin = useXR((s) => s.origin);
  if (!origin) return null;
  return createPortal(
    <mesh ref={reticle} rotation-x={-Math.PI / 2} visible={false} pointerEvents="none">
      <ringGeometry args={[0.06, 0.08, 32]} />
      <meshBasicMaterial color="#3fb950" depthTest={false} />
    </mesh>,
    origin,
  );
}
