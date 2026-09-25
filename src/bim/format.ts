import type { IssuePriority, IssueStatus } from "../../shared/api";

/** IFCBUILDINGSTOREY -> Buildingstorey */
export function prettyCategory(category: string | null) {
  if (!category) return "";
  return category.replace(/^IFC/i, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const STATUS_LABELS: Record<IssueStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
export const PRIORITY_LABELS: Record<IssuePriority, string> = { low: "Low", normal: "Normal", high: "High", critical: "Critical" };

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
