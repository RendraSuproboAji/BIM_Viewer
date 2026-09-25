import { useState } from "react";
import { errorMessage } from "../bim/actions";
import { CLASH_DISCIPLINES, cancelClashRun, clearClashFocus, focusClash, reportClash, runClashDetection } from "../bim/clash-run";
import type { ClashMode } from "../bim/clash";
import { prettyCategory } from "../bim/format";
import type { Discipline } from "../bim/ifc-classes";
import { useCanEdit } from "../bim/session";
import { useViewer } from "../bim/store";

/** Clash detection between two discipline sets, with results and issue creation. */
export function ClashPanel() {
  const hasModels = useViewer((s) => s.models.length > 0);
  const run = useViewer((s) => s.clashRun);
  const loading = useViewer((s) => !!s.loading);
  const projectId = useViewer((s) => s.projectId);
  const canEdit = useCanEdit();
  const [setA, setSetA] = useState<Discipline[]>(["Architecture", "Structure"]);
  const [setB, setSetB] = useState<Discipline[]>(["MEP"]);
  const [mode, setMode] = useState<ClashMode>("hard");
  const [toleranceMm, setToleranceMm] = useState(10);
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { setError, setActiveIssueId } = useViewer.getState();

  if (!hasModels) return <p className="empty">Open the models to check (e.g. architecture, structure and MEP) to find clashes between them.</p>;

  const toggle = (list: Discipline[], set: (l: Discipline[]) => void, d: Discipline) => set(list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);
  const reportAll = async () => {
    if (!run) return;
    const pending = run.results.map((_, i) => i).filter((i) => !(i in run.reported));
    if (!confirm(`Create ${pending.length} clash issue(s) with snapshots?`)) return;
    try {
      for (let n = 0; n < pending.length; n++) {
        setBusy(`Creating issue ${n + 1} / ${pending.length}…`);
        setActive(pending[n]);
        await reportClash(pending[n]);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="library">
      <section>
        <h3>Clash detection</h3>
        <div className="clash-sets">
          <fieldset>
            <legend>Set A</legend>
            {CLASH_DISCIPLINES.map((d) => (
              <label key={d} className="check-row small">
                <input type="checkbox" checked={setA.includes(d)} onChange={() => toggle(setA, setSetA, d)} /> {d}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Set B</legend>
            {CLASH_DISCIPLINES.map((d) => (
              <label key={d} className="check-row small">
                <input type="checkbox" checked={setB.includes(d)} onChange={() => toggle(setB, setSetB, d)} /> {d}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="search-form">
          <select value={mode} onChange={(e) => setMode(e.target.value as ClashMode)} aria-label="Clash type">
            <option value="hard">Hard clashes (intersecting)</option>
            <option value="clearance">Clearance (closer than…)</option>
          </select>
          <label className="check-row small" title={mode === "hard" ? "Ignore overlaps shallower than this (touching elements)" : "Report elements closer than this"}>
            {mode === "hard" ? "ignore <" : "within"}
            <input type="number" min={0} max={5000} step={1} value={toleranceMm} onChange={(e) => setToleranceMm(Math.max(0, Number(e.target.value)))} aria-label="Tolerance in mm" style={{ width: 70 }} />
            mm
          </label>
        </div>
        <div className="inline-form">
          <button
            className="primary"
            disabled={!setA.length || !setB.length || loading}
            onClick={async () => {
              // A focused clash isolates two elements, and hidden elements are skipped: restore the view first.
              if (active !== null) await clearClashFocus();
              setActive(null);
              await runClashDetection(setA, setB, mode, toleranceMm / 1000);
            }}
          >
            Run
          </button>
          {loading && <button onClick={cancelClashRun}>Cancel</button>}
          {active !== null && (
            <button
              onClick={() => {
                setActive(null);
                void clearClashFocus();
              }}
            >
              Show all
            </button>
          )}
        </div>
        <p className="muted small" style={{ margin: "0 12px" }}>
          Hidden elements are left out. Pipes through wall openings don't clash (the opening is cut from the wall).
        </p>
      </section>

      {run && (
        <section data-run-id={run.id}>
          <h3>
            {run.results.length} clash{run.results.length === 1 ? "" : "es"}
          </h3>
          <p className="muted small" style={{ margin: "0 12px 6px" }}>
            {run.setA.join(" + ")} × {run.setB.join(" + ")} · {run.mode === "hard" ? `hard, ignoring < ${run.tolerance * 1000} mm` : `clearance ${run.tolerance * 1000} mm`} ·{" "}
            {run.candidates} pairs tested in {(run.durationMs / 1000).toFixed(1)} s
          </p>
          {canEdit && projectId && run.results.length > 0 && (
            <div className="inline-form">
              <button onClick={reportAll} disabled={!!busy || Object.keys(run.reported).length === run.results.length}>
                Create issues for all
              </button>
              {busy && <span className="muted small">{busy}</span>}
            </div>
          )}
          {run.results.map((c, i) => (
            <div key={`${c.a.key}|${c.b.key}`} className={`row clash-row${active === i ? " selected" : ""}`}>
              <span
                className="label"
                onClick={() => {
                  setActive(i);
                  void focusClash(c);
                }}
                title={`${c.a.name ?? c.a.guid} × ${c.b.name ?? c.b.guid}`}
              >
                <span className="clash-dot a" />
                {c.a.name || prettyCategory(c.a.category)}
                <span className="muted"> × </span>
                <span className="clash-dot b" />
                {c.b.name || prettyCategory(c.b.category)}
                <span className="muted small">
                  {" "}
                  · {prettyCategory(c.a.category)}/{prettyCategory(c.b.category)}
                  {c.distance > 0 && ` · ${(c.distance * 1000).toFixed(0)} mm`}
                </span>
              </span>
              {run.reported[i] ? (
                <button className="link small" onClick={() => setActiveIssueId(null)} title="Reported">
                  #{run.reported[i]}
                </button>
              ) : (
                canEdit &&
                projectId && (
                  <button
                    className="icon visible"
                    title="Create an issue for this clash"
                    onClick={async () => {
                      setActive(i);
                      try {
                        await reportClash(i);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    ⚑
                  </button>
                )
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
