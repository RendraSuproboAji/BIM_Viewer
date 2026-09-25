import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type * as THREE from "three";
import {
  centroid,
  deltas,
  formatLength,
  formatMeasurement,
  midpoint,
  polylineLength,
  REQUIRED_POINTS,
  type Measurement,
  type Point,
  type SnapKind,
} from "../bim/measure";
import { useViewer } from "../bim/store";

const COLOR = "#4fc3f7";
const DRAFT_COLOR = "#ffb020";
const SNAP_COLORS: Record<SnapKind, string> = { vertex: "#ff5252", edge: "#ffd740", face: "#4fc3f7" };

/** 3D overlay (inside the Canvas): finished measurements, the one being drawn, and the snap marker. */
export function MeasurementOverlay({ hover }: { hover: { point: Point; kind: SnapKind } | null }) {
  const measurements = useViewer((s) => s.measurements);
  const draft = useViewer((s) => s.draft);
  const tool = useViewer((s) => s.tool);

  return (
    <group renderOrder={999}>
      {measurements.map((m) => (
        <MeasurementShape key={m.id} m={m} color={COLOR} />
      ))}
      {tool !== "select" && draft.length > 0 && (
        <MeasurementShape m={{ kind: tool, points: hover ? [...draft, hover.point] : draft }} color={DRAFT_COLOR} draft />
      )}
      {tool !== "select" && hover && (
        <Dot position={hover.point} color={SNAP_COLORS[hover.kind]} size={9} />
      )}
    </group>
  );
}

function MeasurementShape({ m, color, draft = false }: { m: Pick<Measurement, "kind" | "points">; color: string; draft?: boolean }) {
  const closed = m.kind === "area" && !draft && m.points.length >= 3;
  const linePoints = useMemo(() => (closed ? [...m.points, m.points[0]] : m.points), [closed, m.points]);
  const complete = m.points.length >= REQUIRED_POINTS[m.kind];

  const label = useMemo(() => {
    if (!complete) {
      return m.kind === "area" && m.points.length >= 2 ? formatLength(polylineLength(m.points)) : null;
    }
    return formatMeasurement(m);
  }, [complete, m]);

  const anchor: Point =
    m.kind === "distance" && m.points.length >= 2
      ? midpoint(m.points[0], m.points[1])
      : m.kind === "angle" && m.points.length >= 2
        ? m.points[1]
        : centroid(m.points);

  return (
    <group>
      {linePoints.length >= 2 && <Line points={linePoints} color={color} lineWidth={2.5} depthTest={false} dashed={draft} dashSize={0.2} gapSize={0.1} />}
      {m.points.map((p, i) => (
        <Dot key={i} position={p} color={color} size={5} />
      ))}
      {label && (
        <Html position={anchor} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`measure-label${draft ? " draft" : ""}`}>
            {label}
            {m.kind === "distance" && complete && <Deltas a={m.points[0]} b={m.points[1]} />}
          </div>
        </Html>
      )}
    </group>
  );
}

/** A sphere that keeps a constant on-screen size (in pixels) at any zoom level. */
function Dot({ position, color, size }: { position: Point; color: string; size: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ camera, size: viewport }) => {
    if (!mesh.current) return;
    const distance = camera.position.distanceTo(mesh.current.position);
    const fov = "fov" in camera ? ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180 : 1;
    const worldPerPixel = (2 * distance * Math.tan(fov / 2)) / viewport.height;
    mesh.current.scale.setScalar(worldPerPixel * size);
  });
  return (
    <mesh ref={mesh} position={position} renderOrder={1000}>
      <sphereGeometry args={[0.5, 16, 12]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  );
}

function Deltas({ a, b }: { a: Point; b: Point }) {
  const d = deltas(a, b);
  return (
    <div className="measure-deltas">
      ΔX {formatLength(d.dx)} · ΔY {formatLength(d.dy)} · ΔZ {formatLength(d.dz)}
    </div>
  );
}

const TOOL_HELP: Record<string, string> = {
  distance: "Click two points.",
  angle: "Click three points; the angle is measured at the second.",
  area: "Click the corners; click the first point or press Enter to close.",
};

/** Hint over the viewport while measuring. Click-through, so it never blocks picking points. */
export function MeasurementHint() {
  const tool = useViewer((s) => s.tool);
  const draft = useViewer((s) => s.draft.length);
  if (tool === "select") return null;
  return (
    <div className="measure-hint" role="status">
      <strong>Measure {tool}:</strong> {TOOL_HELP[tool]}
      {draft > 0 && <span className="muted"> ({draft} point{draft === 1 ? "" : "s"})</span>}
      <br />
      <span className="muted">
        Snaps to <span style={{ color: SNAP_COLORS.vertex }}>● vertex</span> <span style={{ color: SNAP_COLORS.edge }}>● edge</span>{" "}
        <span style={{ color: SNAP_COLORS.face }}>● face</span> · Backspace undoes · Esc cancels, Esc again exits
      </span>
    </div>
  );
}

/** List of measurements, docked in the side panel so it never covers the model. */
export function MeasurementList() {
  const measurements = useViewer((s) => s.measurements);
  const { removeMeasurement, clearMeasurements } = useViewer.getState();
  if (measurements.length === 0) return null;

  return (
    <div className="measure-panel">
      <h2>
        Measurements ({measurements.length})
        <button className="link" onClick={clearMeasurements}>
          Clear all
        </button>
      </h2>
      <div className="measure-list">
        {measurements.map((m, i) => (
          <div key={m.id} className="row">
            <span className="label">
              {i + 1}. {m.kind[0].toUpperCase() + m.kind.slice(1)}: <strong>{formatMeasurement(m)}</strong>
              {m.kind === "area" && <span className="muted"> · perimeter {formatLength(polylineLength(m.points, true))}</span>}
            </span>
            <button className="icon" title="Delete measurement" onClick={() => removeMeasurement(m.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
