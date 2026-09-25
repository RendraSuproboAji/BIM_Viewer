import { engine } from "../bim/engine";
import { PROPERTIES_QUERY, toGroups, type PropertyGroup } from "../bim/properties";
import { useViewer } from "../bim/store";
import { useAsyncValue } from "../hooks/useAsyncValue";

export function Properties() {
  const selection = useViewer((s) => s.selection);
  const { value: groups } = useAsyncValue(selection, async (sel): Promise<PropertyGroup[] | null> => {
    const model = sel && engine.getModel(sel.modelId);
    if (!model) return null;
    const [data] = await model.getItemsData([sel.localId], PROPERTIES_QUERY);
    return data ? toGroups(data) : [];
  });

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

