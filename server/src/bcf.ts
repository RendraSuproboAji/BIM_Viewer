import { randomUUID } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { XMLParser } from "fast-xml-parser";
import {
  ISSUE_PRIORITIES,
  type BcfCamera,
  type BcfClippingPlane,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/api.ts";

/**
 * BCF 2.1 (BIM Collaboration Format) read/write: the zip format Revit, Navisworks,
 * Solibri, BIMcollab etc. use to exchange issues. One folder per topic with
 * markup.bcf, viewpoint.bcfv and snapshot.png.
 */

export interface BcfTopic {
  guid: string;
  title: string;
  description: string;
  status: IssueStatus;
  type: string;
  priority: IssuePriority;
  index: number | null;
  labels: string[];
  creationDate: string;
  creationAuthor: string;
  modifiedDate: string | null;
  dueDate: string | null;
  assignedTo: string | null;
  comments: { guid: string; date: string; author: string; text: string }[];
  viewpoint: {
    camera: BcfCamera | null;
    clippingPlanes: BcfClippingPlane[];
    selection: string[];
  } | null;
  snapshot: Uint8Array | null;
}

// ---- Status / priority mapping -------------------------------------------------------------------

const STATUS_OUT: Record<IssueStatus, string> = { open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed" };

export function statusFromBcf(value: string | undefined): IssueStatus {
  const v = (value ?? "").toLowerCase();
  if (v.includes("progress") || v.includes("active")) return "in_progress";
  if (v.includes("resolv") || v.includes("fixed") || v.includes("done")) return "resolved";
  if (v.includes("clos")) return "closed";
  return "open";
}

export function priorityFromBcf(value: string | undefined): IssuePriority {
  const v = (value ?? "").toLowerCase();
  const exact = ISSUE_PRIORITIES.find((p) => p === v);
  if (exact) return exact;
  if (v.includes("crit")) return "critical";
  if (v.includes("high") || v.includes("major")) return "high";
  if (v.includes("low") || v.includes("minor")) return "low";
  return "normal";
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Export --------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const el = (tag: string, value: string | number | null | undefined) => (value == null || value === "" ? "" : `<${tag}>${esc(String(value))}</${tag}>`);
const xyz = (tag: string, [x, y, z]: [number, number, number]) => `<${tag}><X>${x}</X><Y>${y}</Y><Z>${z}</Z></${tag}>`;

function markupXml(t: BcfTopic, viewpointGuid: string | null) {
  // Element order follows the BCF 2.1 markup.xsd sequence.
  const topic = [
    el("Title", t.title),
    el("Priority", capitalize(t.priority)),
    el("Index", t.index),
    ...t.labels.map((l) => el("Labels", l)),
    el("CreationDate", t.creationDate),
    el("CreationAuthor", t.creationAuthor),
    el("ModifiedDate", t.modifiedDate),
    el("DueDate", t.dueDate),
    el("AssignedTo", t.assignedTo),
    el("Description", t.description),
  ].join("");
  const comments = t.comments
    .map((c) => `<Comment Guid="${esc(c.guid)}">${el("Date", c.date)}${el("Author", c.author)}${el("Comment", c.text)}</Comment>`)
    .join("");
  const viewpoints = viewpointGuid
    ? `<Viewpoints Guid="${viewpointGuid}"><Viewpoint>viewpoint.bcfv</Viewpoint>${t.snapshot ? "<Snapshot>snapshot.png</Snapshot>" : ""}</Viewpoints>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<Topic Guid="${esc(t.guid)}" TopicType="${esc(capitalize(t.type))}" TopicStatus="${esc(STATUS_OUT[t.status])}">${topic}</Topic>
${comments}${viewpoints}
</Markup>`;
}

function viewpointXml(t: BcfTopic, viewpointGuid: string) {
  const vp = t.viewpoint!;
  const selection = vp.selection.length
    ? `<Selection>${vp.selection.map((g) => `<Component IfcGuid="${esc(g)}"/>`).join("")}</Selection>`
    : "";
  const camera = vp.camera
    ? `<PerspectiveCamera>${xyz("CameraViewPoint", vp.camera.viewPoint)}${xyz("CameraDirection", vp.camera.direction)}${xyz("CameraUpVector", vp.camera.upVector)}<FieldOfView>${vp.camera.fieldOfView}</FieldOfView></PerspectiveCamera>`
    : "";
  const planes = vp.clippingPlanes.length
    ? `<ClippingPlanes>${vp.clippingPlanes.map((p) => `<ClippingPlane>${xyz("Location", p.location)}${xyz("Direction", p.direction)}</ClippingPlane>`).join("")}</ClippingPlanes>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${viewpointGuid}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<Components>${selection}<Visibility DefaultVisibility="true"/></Components>${camera}${planes}
</VisualizationInfo>`;
}

export function writeBcf(topics: BcfTopic[]) {
  const files: Zippable = {
    "bcf.version": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DetailedVersion>2.1</DetailedVersion></Version>`),
  };
  for (const t of topics) {
    const viewpointGuid = t.viewpoint || t.snapshot ? randomUUID() : null;
    files[`${t.guid}/markup.bcf`] = strToU8(markupXml(t, viewpointGuid));
    if (viewpointGuid) {
      files[`${t.guid}/viewpoint.bcfv`] = strToU8(viewpointXml({ ...t, viewpoint: t.viewpoint ?? { camera: null, clippingPlanes: [], selection: [] } }, viewpointGuid));
      if (t.snapshot) files[`${t.guid}/snapshot.png`] = [t.snapshot, { level: 0 }];
    }
  }
  return zipSync(files, { level: 6 });
}

// ---- Import --------------------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["Comment", "Viewpoints", "ViewPoint", "Labels", "Component", "ClippingPlane", "Label"].includes(name),
});

// "Comment" is both the comment element and its text child, and is parsed as an array: unwrap arrays.
const text = (v: unknown): string =>
  v == null ? "" : Array.isArray(v) ? text(v[0]) : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v);
const num = (v: unknown) => Number(text(v));
const vec = (v: unknown): [number, number, number] => {
  const o = (v ?? {}) as Record<string, unknown>;
  return [num(o.X), num(o.Y), num(o.Z)];
};
const finite = (v: [number, number, number]) => v.every(Number.isFinite);

export class BcfError extends Error {}

/** Reads a .bcfzip (BCF 2.0 / 2.1, and the BCF 3.0 layout) into topics. */
export function readBcf(bytes: Uint8Array): BcfTopic[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new BcfError("Not a valid .bcfzip file");
  }
  const byFolder = new Map<string, Record<string, Uint8Array>>();
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length !== 2) continue;
    const [folder, file] = parts;
    const entry = byFolder.get(folder) ?? {};
    entry[file.toLowerCase()] = data;
    entry[`__raw:${file}`] = data;
    byFolder.set(folder, entry);
  }
  const topics: BcfTopic[] = [];
  for (const [folder, entry] of byFolder) {
    if (!entry["markup.bcf"]) continue;
    const markup = parser.parse(strFromU8(entry["markup.bcf"])).Markup;
    const topic = markup?.Topic;
    if (!topic) continue;
    const guid = String(topic["@_Guid"] ?? folder);

    // Viewpoint + snapshot: the first viewpoint listed (or the conventional file names).
    const vpList = (markup.Viewpoints ?? []) as Record<string, unknown>[];
    const vpRef = vpList[0];
    const vpFile = text(vpRef?.Viewpoint) || "viewpoint.bcfv";
    const snapFile = text(vpRef?.Snapshot) || "snapshot.png";
    const vpData = entry[`__raw:${vpFile}`] ?? entry[vpFile.toLowerCase()];
    const snapshot = entry[`__raw:${snapFile}`] ?? entry[snapFile.toLowerCase()] ?? null;

    let viewpoint: BcfTopic["viewpoint"] = null;
    if (vpData) {
      const info = parser.parse(strFromU8(vpData)).VisualizationInfo ?? {};
      const cam = info.PerspectiveCamera;
      let camera: BcfCamera | null = null;
      if (cam) {
        const c = { viewPoint: vec(cam.CameraViewPoint), direction: vec(cam.CameraDirection), upVector: vec(cam.CameraUpVector), fieldOfView: num(cam.FieldOfView) || 60 };
        if (finite(c.viewPoint) && finite(c.direction) && finite(c.upVector)) camera = c;
      }
      const planes = ((info.ClippingPlanes?.ClippingPlane ?? []) as Record<string, unknown>[])
        .map((p) => ({ location: vec(p.Location), direction: vec(p.Direction) }))
        .filter((p) => finite(p.location) && finite(p.direction));
      const selection = ((info.Components?.Selection?.Component ?? []) as Record<string, unknown>[])
        .map((c) => String(c["@_IfcGuid"] ?? ""))
        .filter(Boolean);
      viewpoint = { camera, clippingPlanes: planes, selection };
    }

    // BCF 3.0 nests comments under Topic/Comments and labels under Topic/Labels/Label.
    const rawComments = (markup.Comment ?? topic.Comments?.Comment ?? []) as Record<string, unknown>[];
    const labels = [...((topic.Labels ?? []) as unknown[]).flatMap((l) => (typeof l === "object" && l && "Label" in l ? ((l as { Label: unknown[] }).Label) : [l]))]
      .map(text)
      .filter(Boolean);

    topics.push({
      guid,
      title: text(topic.Title) || "Untitled issue",
      description: text(topic.Description),
      status: statusFromBcf(String(topic["@_TopicStatus"] ?? "")),
      type: (String(topic["@_TopicType"] ?? "issue").toLowerCase() || "issue").slice(0, 40),
      priority: priorityFromBcf(text(topic.Priority)),
      index: Number.isFinite(num(topic.Index)) && text(topic.Index) ? num(topic.Index) : null,
      labels,
      creationDate: text(topic.CreationDate) || new Date().toISOString(),
      creationAuthor: text(topic.CreationAuthor),
      modifiedDate: text(topic.ModifiedDate) || null,
      dueDate: text(topic.DueDate) || null,
      assignedTo: text(topic.AssignedTo) || null,
      comments: rawComments
        .map((c) => ({ guid: String(c["@_Guid"] ?? randomUUID()), date: text(c.Date), author: text(c.Author), text: text(c.Comment) }))
        .filter((c) => c.text),
      viewpoint,
      snapshot,
    });
  }
  if (!topics.length && !files["bcf.version"]) throw new BcfError("No BCF topics found in the file");
  return topics;
}
