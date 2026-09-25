/** CSV writing shared by the web app (takeoff export) and the server (element export). */

/** CSV with a BOM (so Excel reads UTF-8) and CRLF line endings. */
export function csvDocument(rows: unknown[][]) {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvCell(value: unknown) {
  const s = String(value ?? "");
  // Neutralise formula-like cells (CSV injection) but keep plain numbers such as "-5" or "+3.2".
  const formula = /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s);
  const safe = formula ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
