// src/lib/accounting/csv.ts
// Minimal CSV serializer. Handles commas, quotes, newlines, and nulls.
// Prepends a UTF-8 BOM so Excel on Windows renders UTF-8 correctly.

export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return "\uFEFF" + lines.join("\r\n");
}
