/** IFCBUILDINGSTOREY -> Buildingstorey */
export function prettyCategory(category: string | null) {
  if (!category) return "";
  return category.replace(/^IFC/i, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
