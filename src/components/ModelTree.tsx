import type { FragmentsModel, SpatialTreeItem } from "@thatopen/fragments";
import { useEffect, useMemo, useState } from "react";
import { exportFrag, removeModel, select, setItemsVisible, setModelVisible } from "../bim/actions";
import { engine } from "../bim/engine";
import { prettyCategory } from "../bim/format";
import { useViewer, type ModelInfo } from "../bim/store";

export function ModelTree() {
  const models = useViewer((s) => s.models);
  if (models.length === 0) {
    return <p className="empty">No models loaded. Open an .ifc or .frag file, or drop one on the viewer.</p>;
  }
  return (
    <div className="tree">
      {models.map((m) => (
        <ModelNode key={m.id} info={m} />
      ))}
    </div>
  );
}

function ModelNode({ info }: { info: ModelInfo }) {
  const [tree, setTree] = useState<SpatialTreeItem | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    engine.getModel(info.id)?.getSpatialStructure().then(setTree);
  }, [info.id]);

  return (
    <div className="tree-model">
      <div className="row model-row">
        <Caret open={open} onClick={() => setOpen(!open)} />
        <span className="label" title={info.name}>{info.name}</span>
        <IconButton title={info.visible ? "Hide model" : "Show model"} onClick={() => setModelVisible(info.id, !info.visible)}>
          {info.visible ? "👁" : "◌"}
        </IconButton>
        <IconButton title="Export as .frag" onClick={() => exportFrag(info.id)}>⤓</IconButton>
        <IconButton title="Remove model" onClick={() => removeModel(info.id)}>✕</IconButton>
      </div>
      {open && tree?.children?.map((child, i) => <TreeNode key={i} modelId={info.id} node={child} depth={1} />)}
      {open && !tree && <p className="empty">Reading spatial structure…</p>}
    </div>
  );
}

// Keyed by model instance so a removed-then-reloaded model never shows stale names.
const nameCache = new WeakMap<FragmentsModel, Map<number, string>>();

function TreeNode(props: { modelId: string; node: SpatialTreeItem; depth: number; parentCategory?: string | null }) {
  const { modelId, node, depth } = props;
  const [open, setOpen] = useState(depth < 3);
  const [visibility, setVisibility] = useState<"all" | "some" | "none">("all");
  const [name, setName] = useState<string | null>(null);
  const selection = useViewer((s) => s.selection);
  const visibilityVersion = useViewer((s) => s.visibilityVersion);
  const children = node.children ?? [];
  const isSelected = selection?.modelId === modelId && selection.localId === node.localId;
  const ids = useMemo(() => collectIds(node), [node]);

  useEffect(() => {
    const model = engine.getModel(modelId);
    if (node.localId === null || !model) return;
    let names = nameCache.get(model);
    if (!names) nameCache.set(model, (names = new Map()));
    const cached = names.get(node.localId);
    if (cached !== undefined) return setName(cached);
    const localId = node.localId;
    model.getItemsData([localId], { attributesDefault: false, attributes: ["Name", "LongName"] }).then(([data]) => {
      const attr = (data?.LongName ?? data?.Name) as { value?: unknown } | undefined;
      const value = attr?.value != null ? String(attr.value) : "";
      names.set(localId, value);
      setName(value);
    });
  }, [modelId, node.localId]);

  // Re-read visibility whenever anything (tree, classes, isolate, show all) changes it.
  useEffect(() => {
    let cancelled = false;
    engine
      .getModel(modelId)
      ?.getVisible(ids)
      .then((flags) => {
        if (cancelled) return;
        const shown = flags.filter(Boolean).length;
        setVisibility(shown === flags.length ? "all" : shown === 0 ? "none" : "some");
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, ids, visibilityVersion]);

  // Element nodes usually sit under a category group node that carries their class.
  const category = prettyCategory(node.category ?? (node.localId !== null ? props.parentCategory ?? null : null));
  const label = node.localId === null ? `${category} (${children.length})` : name || category || `#${node.localId}`;

  // Partly hidden nodes become fully visible first.
  const toggleVisible = () => setItemsVisible(modelId, ids, visibility !== "all");

  const onSelect = async () => {
    if (node.localId === null) return setOpen(!open);
    await select({ modelId, localId: node.localId });
    // Storeys, buildings etc. have no geometry of their own: frame their contents.
    useViewer.getState().requestFit({ modelId, localIds: ids });
  };

  return (
    <>
      <div className={`row${isSelected ? " selected" : ""}`} style={{ paddingLeft: depth * 12 }}>
        {children.length > 0 ? <Caret open={open} onClick={() => setOpen(!open)} /> : <span className="caret" />}
        <span className="label" onClick={onSelect} title={node.localId !== null ? `${category} #${node.localId}` : undefined}>
          {label}
          {node.localId !== null && name && category && <span className="muted"> · {category}</span>}
        </span>
        <IconButton title={visibility === "all" ? "Hide" : visibility === "some" ? "Partly hidden – show all" : "Show"} onClick={toggleVisible}>
          {visibility === "all" ? "👁" : visibility === "some" ? "◐" : "◌"}
        </IconButton>
      </div>
      {open && children.map((c, i) => <TreeNode key={i} modelId={modelId} node={c} depth={depth + 1} parentCategory={node.localId === null ? node.category : null} />)}
    </>
  );
}

function collectIds(node: SpatialTreeItem, out: number[] = []) {
  if (node.localId !== null) out.push(node.localId);
  for (const c of node.children ?? []) collectIds(c, out);
  return out;
}

function Caret({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="caret" onClick={onClick} aria-label={open ? "Collapse" : "Expand"}>
      {open ? "▾" : "▸"}
    </button>
  );
}

function IconButton(props: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon" title={props.title} aria-label={props.title} onClick={props.onClick}>
      {props.children}
    </button>
  );
}
