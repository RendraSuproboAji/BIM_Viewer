import { useFrame, useThree } from "@react-three/fiber";
import { Container, Text } from "@react-three/uikit";
import { useRef } from "react";
import * as THREE from "three";
import { setClassesVisible, setGhost } from "../bim/actions";
import { engine } from "../bim/engine";
import { disciplineOf, type Discipline } from "../bim/ifc-classes";
import { PROPERTIES_QUERY, toGroups } from "../bim/properties";
import { useViewer } from "../bim/store";
import { useAsyncValue } from "../hooks/useAsyncValue";
import { markUiPress } from "./actions";
import { MODE_LABELS } from "./capabilities";
import { headInTrackingSpace } from "./origin";
import { exitXR } from "./runtime";
import { SCALES, scaleLabel, useXRUi } from "./state";

/**
 * The in-headset panel (VR and MR): menu on the left, the selected element on
 * the right. It lives in tracking space (a child of the XR origin), so it keeps
 * its real size whatever the model scale, and follows the user lazily: it
 * re-centres in front of them when they turn or walk away.
 */
export function XRPanel() {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const target = useRef<{ position: THREE.Vector3; yaw: number } | null>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const { head, yaw } = headInTrackingSpace(camera);
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const wanted = new THREE.Vector3(head.x, head.y - 0.35, head.z).addScaledVector(forward, 0.55);
    const t = target.current;
    const turned = t ? Math.abs(Math.atan2(Math.sin(yaw - t.yaw), Math.cos(yaw - t.yaw))) > THREE.MathUtils.degToRad(40) : true;
    const walked = t ? t.position.distanceTo(wanted) > 0.6 : true;
    if (turned || walked) target.current = { position: wanted, yaw };
    const goal = target.current!;
    g.position.lerp(goal.position, t ? 0.08 : 1);
    g.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, goal.yaw, 0, "YXZ")), t ? 0.08 : 1);
  });

  return (
    <group ref={group} name="xr-panel">
      <Container pixelSize={0.0011} flexDirection="row" gap={12} alignItems="flex-start">
        <Menu />
        <SelectedElement />
      </Container>
    </group>
  );
}

const COLORS = { panel: "#161b22", button: "#30363d", hover: "#484f58", active: "#1f6feb", activeHover: "#388bfd", text: "#e6edf3", muted: "#8b949e" };

function Button({ label, active = false, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <Container
      onPointerDown={markUiPress}
      onClick={() => onClick()}
      backgroundColor={active ? COLORS.active : COLORS.button}
      hover={{ backgroundColor: active ? COLORS.activeHover : COLORS.hover }}
      borderRadius={8}
      paddingX={12}
      paddingY={8}
      cursor="pointer"
    >
      <Text fontSize={16} color={COLORS.text}>
        {label}
      </Text>
    </Container>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <Container flexDirection="row" flexWrap="wrap" gap={6} alignItems="center">
      {children}
    </Container>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text fontSize={13} color={COLORS.muted}>
      {children}
    </Text>
  );
}

/** Disciplines present in the open models, with their classes. */
function useDisciplines() {
  const models = useViewer((s) => s.models);
  return (
    useAsyncValue(models, async (list) => {
      const byDiscipline = new Map<Discipline, string[]>();
      for (const { id } of list) {
        const model = engine.getModel(id);
        if (!model) continue;
        for (const category of new Set(await model.getItemsWithGeometryCategories())) {
          if (!category) continue;
          const d = disciplineOf(category);
          const classes = byDiscipline.get(d) ?? [];
          if (!classes.includes(category)) byDiscipline.set(d, [...classes, category]);
        }
      }
      return byDiscipline;
    }).value ?? new Map<Discipline, string[]>()
  );
}

function Menu() {
  const mode = useXRUi((s) => s.mode)!;
  const scale = useXRUi((s) => s.scale);
  const placed = useXRUi((s) => s.placed);
  const lastDistance = useXRUi((s) => s.lastDistance);
  const section = useViewer((s) => s.section);
  const ghost = useViewer((s) => s.ghost);
  const tool = useViewer((s) => s.tool);
  const hidden = useViewer((s) => s.hiddenClasses);
  const { setSection, setTool } = useViewer.getState();
  const disciplines = useDisciplines();
  const nudge = (delta: number) => setSection({ offset: Math.min(1, Math.max(0, section.offset + delta)) });

  return (
    <Container width={400} flexDirection="column" gap={10} padding={16} backgroundColor={COLORS.panel} borderRadius={16}>
      <Row>
        <Text fontSize={20} fontWeight="bold" color={COLORS.text}>
          {`BIM · ${MODE_LABELS[mode]}`}
        </Text>
        <Container flexGrow={1} />
        <Button label="Exit" onClick={exitXR} />
      </Row>

      <Label>{mode === "vr" ? "View · grip to teleport, left stick to move" : placed ? "Scale" : "Point at a surface and select to place"}</Label>
      <Row>
        {SCALES.map((s) => (
          <Button key={s.label} label={s.label} active={Math.abs(scale - s.value) < 1e-9} onClick={() => useXRUi.setState({ scale: s.value })} />
        ))}
        {mode === "vr" ? (
          <Button label="Start" onClick={() => useXRUi.setState((st) => ({ scale: 1, homeRequest: st.homeRequest + 1 }))} />
        ) : (
          <Button label="Re-place" onClick={() => useXRUi.setState((st) => ({ placeRequest: st.placeRequest + 1 }))} />
        )}
      </Row>

      <Label>{`Section${section.enabled ? ` · ${Math.round(section.offset * 100)}%` : ""}`}</Label>
      <Row>
        <Button label={section.enabled ? "On" : "Off"} active={section.enabled} onClick={() => setSection({ enabled: !section.enabled })} />
        {(["x", "y", "z"] as const).map((axis) => (
          <Button key={axis} label={axis.toUpperCase()} active={section.enabled && section.axis === axis} onClick={() => setSection({ enabled: true, axis })} />
        ))}
        <Button label="−" onClick={() => nudge(-0.05)} />
        <Button label="+" onClick={() => nudge(0.05)} />
        <Button label="Flip" onClick={() => setSection({ flipped: !section.flipped })} />
      </Row>

      <Label>Show</Label>
      <Row>
        <Button label="X-ray" active={ghost} onClick={() => void setGhost(!ghost)} />
        {[...disciplines].map(([d, classes]) => {
          const visible = classes.some((c) => !hidden.has(c));
          return <Button key={d} label={d} active={visible} onClick={() => void setClassesVisible(classes, !visible)} />;
        })}
      </Row>

      <Label>{lastDistance != null ? `Measure · last ${lastDistance.toFixed(3)} m` : "Measure"}</Label>
      <Row>
        <Button label={tool === "distance" ? "Measuring: select two points" : "Distance"} active={tool === "distance"} onClick={() => setTool(tool === "distance" ? "select" : "distance")} />
        {useViewer.getState().measurements.length > 0 && <Button label="Clear" onClick={() => useViewer.getState().clearMeasurements()} />}
      </Row>
      {scale !== 1 && (
        <Text fontSize={12} color={COLORS.muted}>
          {`Model shown at ${scaleLabel(scale)}`}
        </Text>
      )}
    </Container>
  );
}

function SelectedElement() {
  const selection = useViewer((s) => s.selection);
  const groups = useAsyncValue(selection, async (sel) => {
    const model = sel && engine.getModel(sel.modelId);
    if (!model) return null;
    const [data] = await model.getItemsData([sel.localId], PROPERTIES_QUERY);
    return data ? toGroups(data) : [];
  }).value;
  if (!selection) {
    return (
      <Container width={320} padding={16} backgroundColor={COLORS.panel} borderRadius={16}>
        <Text fontSize={15} color={COLORS.muted}>
          Point at an element and select (trigger or pinch) to see its properties.
        </Text>
      </Container>
    );
  }
  const rows = (groups ?? []).flatMap((g) => g.rows.map(([k, v]) => [g.title, k, v] as const)).slice(0, 12);
  return (
    <Container width={320} flexDirection="column" gap={4} padding={16} backgroundColor={COLORS.panel} borderRadius={16}>
      <Text fontSize={18} fontWeight="bold" color={COLORS.text}>
        Selected element
      </Text>
      {!groups && (
        <Text fontSize={14} color={COLORS.muted}>
          Loading…
        </Text>
      )}
      {rows.map(([group, key, value], i) => (
        <Container key={i} flexDirection="row" gap={8}>
          <Text fontSize={13} color={COLORS.muted} width={110}>
            {key}
          </Text>
          <Text fontSize={13} color={COLORS.text} flexShrink={1}>
            {String(value).slice(0, 80) || (group === key ? "" : "—")}
          </Text>
        </Container>
      ))}
    </Container>
  );
}
