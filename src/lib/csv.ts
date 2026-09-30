/** RFC 4180 CSV with a UTF-8 BOM so spreadsheet apps detect the encoding. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s: string;
  if (value instanceof Date) s = value.toISOString().slice(0, 10);
  else if (Array.isArray(value)) s = value.join("; ");
  else s = String(value);
  // Guard against spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",") + "\r\n";
}

export const CSV_BOM = "﻿";

/** Normalises any date-ish value to YYYY-MM-DD. */
export function csvDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
