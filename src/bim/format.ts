import type { NoteStatus } from "../../shared/api";

/** IFCBUILDINGSTOREY -> Buildingstorey */
export function prettyCategory(category: string | null) {
  if (!category) return "";
  return category.replace(/^IFC/i, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const STATUS_LABELS: Record<NoteStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
