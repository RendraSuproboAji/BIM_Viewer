import { useMemo, useState } from "react";
import { csvDocument } from "../../shared/csv";
import { errorMessage, select } from "../bim/actions";
import { applyColorBy, clearColorBy, toggleLegendEntry } from "../bim/colorby";
import { engine, HIGHLIGHT } from "../bim/engine";
import { openModelElements } from "../bim/model-data";
import { useViewer } from "../bim/store";
import { listFields, takeoff, type FieldInfo, type FieldKey, type ModelElements, type TakeoffRow } from "../bim/takeoff";
import { useAsyncValue } from "../hooks/useAsyncValue";
import { ComparePanel } from "./ComparePanel";
import { Modal } from "./ProjectMenu";

/** Element data of the open models, re-read when models change. */
function useModelData() {
  const models = useViewer((s) => s.models);
  const { value: data, error } = useAsyncValue(models, async (list): Promise<{ models: ModelElements[]; fields: FieldInfo[] } | null> => {
    if (!list.length) return null;
    const m = await openModelElements();
    return { models: m, fields: listFields(m.flatMap((x) => x.elements)) };
  });
  return { data, error: error ? errorMessage(error) : null, hasModels: models.length > 0 };
}

/** Left-panel tab: colour by property + quantity takeoff. */
export function DataPanel() {
  const { data, error, hasModels } = useModelData();
  const [takeoffOpen, setTakeoffOpen] = useState(false);
  if (!hasModels) return <p className="empty">Open a model to colour it by property or take off quantities.</p>;
  if (error) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">Reading element data…</p>;
  return (
    <div className="library">
      <ColorBy fields={data.fields} />
      <section>
        <h3>Quantity takeoff</h3>
        <p className="muted small" style={{ margin: "0 12px 6px" }}>
          Counts and sums of quantities, grouped by class, storey, type or any property. Exports to CSV (Excel).
        </p>
        <div className="inline-form">
          <button className="primary" onClick={() => setTakeoffOpen(true)}>
            Open takeoff
          </button>
        </div>
      </section>
      <ComparePanel />
      {takeoffOpen && <TakeoffDialog data={data} onClose={() => setTakeoffOpen(false)} />}
    </div>
  );
}

function FieldOptions({ fields, numericOnly = false }: { fields: FieldInfo[]; numericOnly?: boolean }) {
  const builtin = fields.filter((f) => !f.key.startsWith("prop:"));
  const props = fields.filter((f) => f.key.startsWith("prop:") && (!numericOnly || f.numeric));
  return (
    <>
      {!numericOnly && (
        <optgroup label="Element">
          {builtin.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Properties & quantities">
        {props.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label} ({f.count}){f.numeric ? " #" : ""}
          </option>
        ))}
      </optgroup>
    </>
  );
}

function ColorBy({ fields }: { fields: FieldInfo[] }) {
  const colorBy = useViewer((s) => s.colorBy);
  const [key, setKey] = useState<FieldKey>(colorBy?.key ?? "Class");
  const field = fields.find((f) => f.key === key);
  const [asRange, setAsRange] = useState(true);

  return (
    <section>
      <h3>Colour by property</h3>
      <div className="search-form">
        <select value={key} onChange={(e) => setKey(e.target.value as FieldKey)} aria-label="Colour by">
          <FieldOptions fields={fields} />
        </select>
        {field?.numeric && (
          <label className="check-row small">
            <input type="checkbox" checked={asRange} onChange={(e) => setAsRange(e.target.checked)} /> as ranges
          </label>
        )}
        <button className="primary" onClick={() => applyColorBy(key, !!field?.numeric && asRange)}>
          Colour
        </button>
        {colorBy && <button onClick={clearColorBy}>Clear</button>}
      </div>
      {colorBy && (
        <div className="legend">
          <div className="muted small legend-title">{colorBy.label}</div>
          {colorBy.legend.map((entry) => {
            const hidden = colorBy.hidden.includes(entry.label);
            return (
              <div key={entry.label} className={`row${hidden ? " dim" : ""}`}>
                <span className="swatch" style={{ background: entry.color }} />
                <span className="label" title={`Select ${entry.count} element(s)`} onClick={() => selectItems(entry.items)}>
                  {entry.label}
                </span>
                <span className="badge">{entry.count}</span>
                <button className="icon visible" title={hidden ? "Show" : "Hide"} onClick={() => toggleLegendEntry(entry.label)}>
                  {hidden ? "◌" : "👁"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Highlights a group of elements (first selected, rest highlighted) and frames them. */
async function selectItems(items: Record<string, number[]>) {
  const entries = Object.entries(items).filter(([, ids]) => ids.length);
  if (!entries.length) return;
  const [[firstModel, firstIds]] = entries;
  await select({ modelId: firstModel, localId: firstIds[0] });
  for (const [modelId, ids] of entries) {
    const rest = modelId === firstModel ? ids.slice(1) : ids;
    if (rest.length) await engine.getModel(modelId)?.highlight(rest, HIGHLIGHT);
  }
  await engine.update(true);
  useViewer.getState().requestFit({ modelId: firstModel, localIds: firstIds });
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 3 }));

function TakeoffDialog({ data, onClose }: { data: { models: ModelElements[]; fields: FieldInfo[] }; onClose: () => void }) {
  const numeric = useMemo(() => data.fields.filter((f) => f.numeric), [data.fields]);
  // Default quantities: volume/area/length-like fields.
  const [quantities, setQuantities] = useState<FieldKey[]>(() =>
    numeric.filter((f) => /volume|area|length|volumen|länge|fläche/i.test(f.label)).slice(0, 4).map((f) => f.key),
  );
  const [groupBy, setGroupBy] = useState<FieldKey>("Class");
  const [geomVolume, setGeomVolume] = useState(true);
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => takeoff(data.models, groupBy, quantities), [data.models, groupBy, quantities]);

  // Geometric volume per group, computed from the actual meshes (works without Qto sets).
  const volumes =
    useAsyncValue(geomVolume ? rows : null, async (groups, stale) => {
      if (!groups) return null;
      const out = new Map<string, number>();
      for (const row of groups) {
        let v = 0;
        for (const [modelId, ids] of Object.entries(row.items)) v += (await engine.getModel(modelId)?.getItemsVolume(ids)) ?? 0;
        if (stale()) return null;
        out.set(row.group, v);
      }
      return out;
    }).value ?? null;

  const labelOf = (k: FieldKey) => data.fields.find((f) => f.key === k)?.label ?? k;
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows) for (const q of quantities) t[q] = (t[q] ?? 0) + (r.sums[q] ?? 0);
    return t;
  }, [rows, quantities]);
  const totalVolume = volumes ? [...volumes.values()].reduce((a, b) => a + b, 0) : null;

  const exportCsv = () => {
    const header = [labelOf(groupBy), "Count", ...quantities.map(labelOf), ...(geomVolume ? ["Geometric volume (m³)"] : [])];
    const body = rows.map((r: TakeoffRow) => [r.group, r.count, ...quantities.map((q) => r.sums[q] ?? ""), ...(geomVolume ? [volumes?.get(r.group) ?? ""] : [])]);
    const total = ["Total", rows.reduce((a, r) => a + r.count, 0), ...quantities.map((q) => totals[q] ?? ""), ...(geomVolume ? [totalVolume ?? ""] : [])];
    const blob = new Blob([csvDocument([header, ...body, total])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `takeoff-by-${labelOf(groupBy).replace(/[^\w.-]+/g, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const shownNumeric = numeric.filter((f) => !filter || f.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal title="Quantity takeoff" onClose={onClose} wide>
      <div className="takeoff">
        <div className="takeoff-controls">
          <label>
            Group by
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as FieldKey)} aria-label="Group by">
              <FieldOptions fields={data.fields} />
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={geomVolume} onChange={(e) => setGeomVolume(e.target.checked)} /> Geometric volume (from the 3D shapes)
          </label>
          <div className="quantity-picker">
            <div className="muted small">Quantities to sum ({quantities.length})</div>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter quantities…" aria-label="Filter quantities" />
            <div className="quantity-list">
              {shownNumeric.length === 0 && <p className="muted small">No numeric properties.</p>}
              {shownNumeric.map((f) => (
                <label key={f.key} className="check-row small">
                  <input
                    type="checkbox"
                    checked={quantities.includes(f.key)}
                    onChange={(e) => setQuantities(e.target.checked ? [...quantities, f.key] : quantities.filter((q) => q !== f.key))}
                  />
                  {f.label} <span className="muted">({f.count})</span>
                </label>
              ))}
            </div>
          </div>
          <button className="primary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
        <div className="takeoff-table-wrap">
          <table className="takeoff-table">
            <thead>
              <tr>
                <th>{labelOf(groupBy)}</th>
                <th className="num">Count</th>
                {quantities.map((q) => (
                  <th key={q} className="num" title={labelOf(q)}>
                    {labelOf(q).split(" › ").pop()}
                  </th>
                ))}
                {geomVolume && <th className="num">Volume (m³)</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.group} onClick={() => selectItems(r.items)} title="Select these elements">
                  <td>{r.group}</td>
                  <td className="num">{fmt(r.count)}</td>
                  {quantities.map((q) => (
                    <td key={q} className="num">
                      {r.sums[q] != null ? fmt(r.sums[q]) : ""}
                    </td>
                  ))}
                  {geomVolume && <td className="num">{volumes ? fmt(volumes.get(r.group) ?? 0) : "…"}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th className="num">{fmt(rows.reduce((a, r) => a + r.count, 0))}</th>
                {quantities.map((q) => (
                  <th key={q} className="num">
                    {fmt(totals[q] ?? 0)}
                  </th>
                ))}
                {geomVolume && <th className="num">{totalVolume != null ? fmt(totalVolume) : "…"}</th>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Modal>
  );
}
