import { useState } from "react";
import { clearCompare, COMPARE_COLORS, compareCsv, focusCompared, runCompare } from "../bim/compare-run";
import { prettyCategory } from "../bim/format";
import { useViewer } from "../bim/store";

type Filter = "all" | "added" | "removed" | "changed";

/** Version comparison between two open models (by IFC GlobalId). */
export function ComparePanel() {
  const models = useViewer((s) => s.models);
  const run = useViewer((s) => s.compareRun);
  const [beforeId, setBeforeId] = useState<string>("");
  const [afterId, setAfterId] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  if (models.length < 2) {
    return (
      <section>
        <h3>Compare versions</h3>
        <p className="muted small" style={{ margin: "0 12px" }}>
          Open two versions of a model to see what was added, removed or changed (matched by IFC GlobalId).
        </p>
      </section>
    );
  }
  const before = beforeId || models[0].id;
  const after = afterId || models[models.length - 1].id;
  const name = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  const d = run?.diff;
  const exportCsv = () => {
    if (!run) return;
    const url = URL.createObjectURL(new Blob([compareCsv(run)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `changes-${name(run.beforeId)}-to-${name(run.afterId)}.csv`.replace(/[^\w.-]+/g, "_");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const Chip = ({ kind, count }: { kind: Filter; count: number }) => (
    <button className={`chip-button${filter === kind ? " active" : ""}`} onClick={() => setFilter(filter === kind ? "all" : kind)}>
      {kind !== "all" && <span className="swatch" style={{ background: COMPARE_COLORS[kind] }} />}
      {count} {kind}
    </button>
  );

  return (
    <section>
      <h3>Compare versions</h3>
      <div className="search-form">
        <label className="compare-pick">
          Old
          <select value={before} onChange={(e) => setBeforeId(e.target.value)} aria-label="Old version">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="compare-pick">
          New
          <select value={after} onChange={(e) => setAfterId(e.target.value)} aria-label="New version">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="inline-form">
        <button className="primary" disabled={before === after} onClick={() => runCompare(before, after)}>
          Compare
        </button>
        {run && <button onClick={clearCompare}>Clear</button>}
        {run && <button onClick={exportCsv}>Export CSV</button>}
      </div>
      {d && run && (
        <>
          <p className="muted small" style={{ margin: "4px 12px" }}>
            {name(run.beforeId)} → {name(run.afterId)} · {d.unchanged} unchanged{d.unmatched ? ` · ${d.unmatched} without GlobalId` : ""}
          </p>
          <div className="inline-form compare-chips">
            <Chip kind="added" count={d.added.length} />
            <Chip kind="changed" count={d.changed.length} />
            <Chip kind="removed" count={d.removed.length} />
          </div>
          <div className="compare-list">
            {(filter === "all" || filter === "added") &&
              d.added.map((e) => (
                <div key={`a${e.guid}`} className="row">
                  <span className="swatch" style={{ background: COMPARE_COLORS.added }} />
                  <span className="label" onClick={() => focusCompared(run.afterId, e.localId)}>
                    {e.name || e.guid} <span className="muted">· {prettyCategory(e.category)} · added</span>
                  </span>
                </div>
              ))}
            {(filter === "all" || filter === "changed") &&
              d.changed.map((c) => (
                <div key={`c${c.guid}`}>
                  <div className="row">
                    <span className="swatch" style={{ background: COMPARE_COLORS.changed }} />
                    <span
                      className="label"
                      onClick={() => {
                        setOpen(open === c.guid ? null : c.guid);
                        void focusCompared(run.afterId, c.after.localId);
                      }}
                    >
                      {c.after.name || c.guid}{" "}
                      <span className="muted">
                        · {prettyCategory(c.after.category)} · {c.changes.length} change{c.changes.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>
                  {open === c.guid && (
                    <table className="diff-table">
                      <tbody>
                        {c.changes.map((f) => (
                          <tr key={f.field}>
                            <th>{f.field}</th>
                            <td className="before">{f.before ?? "—"}</td>
                            <td className="after">{f.after ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            {(filter === "all" || filter === "removed") &&
              d.removed.map((e) => (
                <div key={`r${e.guid}`} className="row">
                  <span className="swatch" style={{ background: COMPARE_COLORS.removed }} />
                  <span className="label" onClick={() => focusCompared(run.beforeId, e.localId)}>
                    {e.name || e.guid} <span className="muted">· {prettyCategory(e.category)} · removed</span>
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
