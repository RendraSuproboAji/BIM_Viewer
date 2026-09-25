import type { SpatialTreeItem } from "@thatopen/fragments";
import { useEffect, useState } from "react";
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

const nameCache = new Map<string, string>();

function TreeNode({ modelId, node, depth }: { modelId: string; node: SpatialTreeItem; depth: number }) {
  const [open, setOpen] = useState(depth < 3);
  const [visible, setVisible] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const selection = useViewer((s) => s.selection);
  const children = node.children ?? [];
  const isSelected = selection?.modelId === modelId && selection.localId === node.localId;

  useEffect(() => {
    if (node.localId === null) return;
    const key = `${modelId}:${node.localId}`;
    const cached = nameCache.get(key);
    if (cached !== undefined) return setName(cached);
    engine
      .getModel(modelId)
      ?.getItemsData([node.localId], { attributesDefault: false, attributes: ["Name", "LongName"] })
      .then(([data]) => {
        const attr = (data?.LongName ?? data?.Name) as { value?: unknown } | undefined;
        const value = attr?.value != null ? String(attr.value) : "";
        nameCache.set(key, value);
        setName(value);
      });
  }, [modelId, node.localId]);

  const category = prettyCategory(node.category);
  const label = node.localId === null ? `${category} (${children.length})` : name || category || `#${node.localId}`;

  const toggleVisible = async () => {
    await setItemsVisible(modelId, collectIds(node), !visible);
    setVisible(!visible);
  };

  const onSelect = async () => {
    if (node.localId === null) return setOpen(!open);
    await select({ modelId, localId: node.localId });
    useViewer.getState().requestFit("selection");
  };

  return (
    <>
      <div className={`row${isSelected ? " selected" : ""}`} style={{ paddingLeft: depth * 12 }}>
        {children.length > 0 ? <Caret open={open} onClick={() => setOpen(!open)} /> : <span className="caret" />}
        <span className="label" onClick={onSelect} title={node.localId !== null ? `${category} #${node.localId}` : undefined}>
          {label}
          {node.localId !== null && name && category && <span className="muted"> · {category}</span>}
        </span>
        <IconButton title={visible ? "Hide" : "Show"} onClick={toggleVisible}>
          {visible ? "👁" : "◌"}
        </IconButton>
      </div>
      {open && children.map((c, i) => <TreeNode key={i} modelId={modelId} node={c} depth={depth + 1} />)}
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
