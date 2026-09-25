import { useEffect, useRef, useState } from "react";
import { setClassesVisible } from "../bim/actions";
import { engine } from "../bim/engine";
import { prettyCategory } from "../bim/format";
import { DISCIPLINES, disciplineOf, type Discipline } from "../bim/ifc-classes";
import { useViewer } from "../bim/store";

interface ClassCount {
  category: string;
  count: number;
}

/** IFC classes found across all models, grouped by discipline, with visibility toggles. */
export function Categories() {
  const models = useViewer((s) => s.models);
  const hidden = useViewer((s) => s.hiddenClasses);
  const [groups, setGroups] = useState<Map<Discipline, ClassCount[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const counts = new Map<string, number>();
      for (const { id } of models) {
        const model = engine.getModel(id);
        if (!model) continue;
        // One entry per item with geometry, so this is also the element count.
        for (const category of await model.getItemsWithGeometryCategories()) {
          if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
        }
      }
      const byDiscipline = new Map<Discipline, ClassCount[]>();
      for (const [category, count] of counts) {
        const d = disciplineOf(category);
        byDiscipline.set(d, [...(byDiscipline.get(d) ?? []), { category, count }]);
      }
      for (const list of byDiscipline.values()) list.sort((a, b) => b.count - a.count);
      if (!cancelled) setGroups(byDiscipline);
    })();
    return () => {
      cancelled = true;
    };
  }, [models]);

  if (!groups) return <p className="empty">Reading classes…</p>;
  if (groups.size === 0) return <p className="empty">No classes yet.</p>;

  return (
    <div className="tree">
      {DISCIPLINES.filter((d) => groups.has(d)).map((d) => (
        <DisciplineGroup key={d} discipline={d} classes={groups.get(d)!} hidden={hidden} />
      ))}
    </div>
  );
}

function DisciplineGroup({ discipline, classes, hidden }: { discipline: Discipline; classes: ClassCount[]; hidden: Set<string> }) {
  const [open, setOpen] = useState(true);
  const checkbox = useRef<HTMLInputElement>(null);
  const hiddenCount = classes.filter((c) => hidden.has(c.category)).length;
  const total = classes.reduce((n, c) => n + c.count, 0);

  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = hiddenCount > 0 && hiddenCount < classes.length;
  }, [hiddenCount, classes.length]);

  return (
    <div className="discipline">
      <div className="row model-row">
        <button className="caret" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
        <input
          ref={checkbox}
          type="checkbox"
          checked={hiddenCount === 0}
          onChange={() => setClassesVisible(classes.map((c) => c.category), hiddenCount > 0)}
          aria-label={`Toggle ${discipline}`}
        />
        <span className="label" onClick={() => setOpen(!open)}>{discipline}</span>
        <span className="badge">{total}</span>
      </div>
      {open &&
        classes.map((c) => (
          <label key={c.category} className="row check-row" style={{ paddingLeft: 36 }} title={c.category}>
            <input
              type="checkbox"
              checked={!hidden.has(c.category)}
              onChange={() => setClassesVisible([c.category], hidden.has(c.category))}
            />
            <span className="label">{prettyCategory(c.category)}</span>
            <span className="badge">{c.count}</span>
          </label>
        ))}
    </div>
  );
}
