import type { SpatialTreeItem } from "@thatopen/fragments";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { exportFrag, removeModel, select, setItemsVisible, setModelVisible } from "../bim/actions";
import { engine } from "../bim/engine";
import { prettyCategory } from "../bim/format";
import { saveToLibrary } from "../bim/library";
import { useCan } from "../bim/session";
import { useViewer, type ModelInfo } from "../bim/store";

/** Rows rendered per node before "Show more", so huge storeys stay responsive. */
const PAGE = 200;
const NAME_BATCH = 2000;

interface TreeData {
  modelId: string;
  /** localId → Name/LongName, loaded in bulk once per model. */
  names: Map<number, string>;
  /** Items that have geometry (the only ones visibility applies to). */
  geometry: Set<number>;
  /** Hidden items, re-read once per model on every visibility change. */
  hidden: Set<number>;
}

const TreeContext = createContext<TreeData | null>(null);

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
  // Saving to the library needs the server and a role that may add models.
  const canSave = useCan("models.write");
  const [tree, setTree] = useState<SpatialTreeItem | null>(null);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [geometry, setGeometry] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const visibilityVersion = useViewer((s) => s.visibilityVersion);

  useEffect(() => {
    const model = engine.getModel(info.id);
    if (!model) return;
    let cancelled = false;
    void (async () => {
      const structure = await model.getSpatialStructure();
      if (cancelled) return;
      setTree(structure);
      const withGeometry = new Set(await model.getItemsIdsWithGeometry());
      if (cancelled) return;
      setGeometry(withGeometry);
      const ids = collectIds(structure);
      const map = new Map<number, string>();
      for (let i = 0; i < ids.length; i += NAME_BATCH) {
        const batch = ids.slice(i, i + NAME_BATCH);
        const data = await model.getItemsData(batch, { attributesDefault: false, attributes: ["Name", "LongName"] });
        if (cancelled) return;
        data.forEach((d, j) => {
          const attr = (d?.LongName ?? d?.Name) as { value?: unknown } | undefined;
          if (attr?.value != null && attr.value !== "") map.set(batch[j], String(attr.value));
        });
        setNames(new Map(map));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [info.id]);

  useEffect(() => {
    let cancelled = false;
    engine
      .getModel(info.id)
      ?.getItemsByVisibility(false)
      .then((ids) => !cancelled && setHidden(new Set(ids)));
    return () => {
      cancelled = true;
    };
  }, [info.id, visibilityVersion]);

  const data = useMemo(() => ({ modelId: info.id, names, geometry, hidden }), [info.id, names, geometry, hidden]);

  return (
    <div className="tree-model">
      <div className="row model-row">
        <Caret open={open} onClick={() => setOpen(!open)} />
        <span className="label" title={info.name}>{info.name}</span>
        <IconButton title={info.visible ? "Hide model" : "Show model"} onClick={() => setModelVisible(info.id, !info.visible)}>
          {info.visible ? "👁" : "◌"}
        </IconButton>
        {info.libraryId ? (
          <span className="icon saved" title="Saved in the library">✓</span>
        ) : canSave && (
          <IconButton
            title={saving ? "Saving…" : "Save to library (model + BIM data)"}
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void saveToLibrary(info.id).finally(() => setSaving(false));
            }}
          >
            💾
          </IconButton>
        )}
        <IconButton title="Export as .frag" onClick={() => exportFrag(info.id)}>⤓</IconButton>
        <IconButton title="Remove model" onClick={() => removeModel(info.id)}>✕</IconButton>
      </div>
      <TreeContext.Provider value={data}>
        {open && tree && <Children nodes={tree.children ?? []} depth={1} parentCategory={null} />}
      </TreeContext.Provider>
      {open && !tree && <p className="empty">Reading spatial structure…</p>}
    </div>
  );
}

function Children({ nodes, depth, parentCategory }: { nodes: SpatialTreeItem[]; depth: number; parentCategory: string | null }) {
  const [limit, setLimit] = useState(PAGE);
  const selection = useViewer((s) => s.selection);
  const { modelId } = useContext(TreeContext)!;

  // Reveal the selected element even if it sits beyond the rendered page.
  const selectedIndex = useMemo(
    () =>
      selection && selection.modelId === modelId && nodes.length > PAGE
        ? nodes.findIndex((n) => n.localId === selection.localId || containsId(n, selection.localId))
        : -1,
    [selection, modelId, nodes],
  );
  if (selectedIndex >= limit) setLimit(selectedIndex + 1);

  return (
    <>
      {nodes.slice(0, limit).map((c, i) => (
        <TreeNode key={i} node={c} depth={depth} parentCategory={parentCategory} />
      ))}
      {nodes.length > limit && (
        <button className="row more" style={{ paddingLeft: depth * 12 + 20 }} onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, nodes.length - limit)} more of {nodes.length - limit}…
        </button>
      )}
    </>
  );
}

function TreeNode({ node, depth, parentCategory }: { node: SpatialTreeItem; depth: number; parentCategory: string | null }) {
  const { modelId, names, geometry, hidden } = useContext(TreeContext)!;
  const [open, setOpen] = useState(depth < 3);
  const selection = useViewer((s) => s.selection);
  const row = useRef<HTMLDivElement>(null);
  const children = node.children ?? [];
  const ids = useMemo(() => collectIds(node), [node]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const isSelected = selection?.modelId === modelId && selection.localId === node.localId;
  const containsSelection = selection?.modelId === modelId && node.localId !== selection.localId && idSet.has(selection.localId);

  // Expand towards an element selected in 3D, and bring its row into view.
  // Starts false so a node mounted around the selection (its parent just opened) opens too.
  const [revealed, setRevealed] = useState(false);
  if (containsSelection !== revealed) {
    setRevealed(containsSelection);
    if (containsSelection) setOpen(true);
  }
  useEffect(() => {
    if (isSelected) row.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const visibility = useMemo(() => {
    let total = 0;
    let shown = 0;
    for (const id of ids) {
      if (!geometry.has(id)) continue;
      total++;
      if (!hidden.has(id)) shown++;
    }
    return shown === total ? "all" : shown === 0 ? "none" : "some";
  }, [ids, geometry, hidden]);

  // Element nodes usually sit under a category group node that carries their class.
  const category = prettyCategory(node.category ?? (node.localId !== null ? parentCategory : null));
  const name = node.localId !== null ? names.get(node.localId) : undefined;
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
      <div ref={row} className={`row${isSelected ? " selected" : ""}`} style={{ paddingLeft: depth * 12 }}>
        {children.length > 0 ? <Caret open={open} onClick={() => setOpen(!open)} /> : <span className="caret" />}
        <span className="label" onClick={onSelect} title={node.localId !== null ? `${category} #${node.localId}` : undefined}>
          {label}
          {node.localId !== null && name && category && <span className="muted"> · {category}</span>}
        </span>
        <IconButton title={visibility === "all" ? "Hide" : visibility === "some" ? "Partly hidden – show all" : "Show"} onClick={toggleVisible}>
          {visibility === "all" ? "👁" : visibility === "some" ? "◐" : "◌"}
        </IconButton>
      </div>
      {open && children.length > 0 && (
        <Children nodes={children} depth={depth + 1} parentCategory={node.localId === null ? node.category : null} />
      )}
    </>
  );
}

function collectIds(node: SpatialTreeItem, out: number[] = []) {
  if (node.localId !== null) out.push(node.localId);
  for (const c of node.children ?? []) collectIds(c, out);
  return out;
}

function containsId(node: SpatialTreeItem, id: number): boolean {
  return (node.children ?? []).some((c) => c.localId === id || containsId(c, id));
}

function Caret({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="caret" onClick={onClick} aria-label={open ? "Collapse" : "Expand"}>
      {open ? "▾" : "▸"}
    </button>
  );
}

function IconButton(props: { title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button className="icon" title={props.title} aria-label={props.title} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}
