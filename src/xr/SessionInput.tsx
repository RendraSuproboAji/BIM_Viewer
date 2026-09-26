import { useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { useEffect } from "react";
import * as THREE from "three";
import { handleSelect, handleSqueeze } from "./actions";
import { currentOriginMatrix } from "./origin";

/**
 * BIM input for every XR input source (controllers, hands, phone taps, gaze):
 * select (trigger, pinch, tap) picks / measures / places, squeeze (grip)
 * teleports in VR.
 *
 * Handled on the session, from each event's own frame, so it works for any
 * device and doesn't depend on controller layouts or models having loaded.
 */
export function SessionInput() {
  const session = useXR((s) => s.session);
  const referenceSpace = useXR((s) => s.originReferenceSpace);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    if (!session || !referenceSpace) return;
    const rayOf = (e: XRInputSourceEvent) => {
      const pose = e.frame.getPose(e.inputSource.targetRaySpace, referenceSpace);
      if (!pose) return null;
      // Tracking space → model space through the XR origin.
      const world = currentOriginMatrix().multiply(new THREE.Matrix4().fromArray(pose.transform.matrix));
      const origin = new THREE.Vector3().setFromMatrixPosition(world);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(world);
      return new THREE.Ray(origin, direction);
    };
    const onSelect = (e: XRInputSourceEvent) => {
      const ray = rayOf(e);
      if (ray) handleSelect(ray);
    };
    const onSqueeze = (e: XRInputSourceEvent) => {
      const ray = rayOf(e);
      if (ray) handleSqueeze(ray, camera);
    };
    session.addEventListener("select", onSelect);
    session.addEventListener("squeeze", onSqueeze);
    return () => {
      session.removeEventListener("select", onSelect);
      session.removeEventListener("squeeze", onSqueeze);
    };
  }, [session, referenceSpace, camera]);
  return null;
}
