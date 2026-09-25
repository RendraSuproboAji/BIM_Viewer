import { useEffect, useState } from "react";
import { engine } from "../bim/engine";
import { PROPERTIES_QUERY, toGroups, type PropertyGroup } from "../bim/properties";
import { useViewer } from "../bim/store";

export function Properties() {
  const selection = useViewer((s) => s.selection);
  const [groups, setGroups] = useState<PropertyGroup[] | null>(null);

  useEffect(() => {
    setGroups(null);
    if (!selection) return;
    let cancelled = false;
    const model = engine.getModel(selection.modelId);
    model
      ?.getItemsData([selection.localId], PROPERTIES_QUERY)
      .then(([data]) => !cancelled && setGroups(data ? toGroups(data) : []));
    return () => {
      cancelled = true;
    };
  }, [selection]);

  if (!selection) return <p className="empty">Click an element in the viewer or the tree to see its properties.</p>;
  if (!groups) return <p className="empty">Loading properties…</p>;

  return (
    <div className="props">
      {groups.map((g, i) => (
        <details key={i} open={i < 2}>
          <summary>{g.title}</summary>
          <table>
            <tbody>
              {g.rows.map(([k, v], j) => (
                <tr key={j}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

