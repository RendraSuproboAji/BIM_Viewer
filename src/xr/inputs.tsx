import {
  DefaultXRController,
  DefaultXRHand,
  DefaultXRScreenInput,
  DefaultXRTransientPointer,
} from "@react-three/xr";
import { Component, Suspense, type ReactNode } from "react";

/**
 * Controller, hand, screen and gaze inputs: the default visuals and pointers
 * (which operate the 3D panel). BIM selection, measuring and teleporting are
 * handled per session in ./SessionInput.tsx, independent of these.
 *
 * The default visuals load 3D models from the WebXR input-profiles CDN; if that
 * fails (offline, blocked), only the visual is lost.
 */
class VisualBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}

// Default grab/touch pointers are off: nothing in the scene is grabbable.
export const BimController = () => (
  <>
    <VisualBoundary>
      <DefaultXRController grabPointer={false} teleportPointer={false} />
    </VisualBoundary>
  </>
);

export const BimHand = () => (
  <>
    <VisualBoundary>
      <DefaultXRHand grabPointer={false} touchPointer={false} teleportPointer={false} />
    </VisualBoundary>
  </>
);

export const BimScreenInput = () => (
  <>
    <VisualBoundary>
      <DefaultXRScreenInput />
    </VisualBoundary>
  </>
);

/** Vision Pro gaze + pinch. */
export const BimTransientPointer = () => (
  <>
    <VisualBoundary>
      <DefaultXRTransientPointer />
    </VisualBoundary>
  </>
);
