import { useEffect, useState } from "react";
import { setItemsVisible } from "../bim/actions";
import { engine } from "../bim/engine";
import { useViewer } from "../bim/store";
import { prettyCategory } from "../bim/format";

interface CategoryGroup {
  category: string;
  items: { modelId: string; ids: number[] }[];
  count: number;
}

/** Lists IFC classes found across all models with per-class visibility toggles. */
export function Categories() {
  const models = useViewer((s) => s.models);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const byCategory = new Map<string, CategoryGroup>();
      for (const { id } of models) {
        const model = engine.getModel(id);
        if (!model) continue;
        const withGeometry = new Set((await model.getItemsWithGeometryCategories()).filter(Boolean) as string[]);
        const found = await model.getItemsOfCategories([...withGeometry].map((c) => new RegExp(`^${c}$`)));
        for (const [category, ids] of Object.entries(found)) {
          const group = byCategory.get(category) ?? { category, items: [], count: 0 };
          group.items.push({ modelId: id, ids });
          group.count += ids.length;
          byCategory.set(category, group);
        }
      }
      if (!cancelled) setGroups([...byCategory.values()].sort((a, b) => b.count - a.count));
    })();
    return () => {
      cancelled = true;
    };
  }, [models]);

  const toggle = async (group: CategoryGroup) => {
    const willHide = !hidden.has(group.category);
    for (const { modelId, ids } of group.items) await setItemsVisible(modelId, ids, !willHide);
    const next = new Set(hidden);
    if (willHide) next.add(group.category);
    else next.delete(group.category);
    setHidden(next);
  };

  if (groups.length === 0) return <p className="empty">No categories yet.</p>;

  return (
    <div className="tree">
      {groups.map((g) => (
        <label key={g.category} className="row check-row">
          <input type="checkbox" checked={!hidden.has(g.category)} onChange={() => toggle(g)} />
          <span className="label">{prettyCategory(g.category)}</span>
          <span className="badge">{g.count}</span>
        </label>
      ))}
    </div>
  );
}
