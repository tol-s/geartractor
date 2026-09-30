import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { UNIT_LABEL, type QuantityUnit } from "./domain";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** YYYY-MM-DD for a Date in the given IANA timezone. */
export function isoDateInZone(date: Date, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds calendar months to a YYYY-MM-DD string, clamping to the end of month. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const future = seconds < 0;
  const fmt = (n: number, unit: string) => {
    const s = `${n} ${unit}${n === 1 ? "" : "s"}`;
    return future ? `in ${s}` : `${s} ago`;
  };
  if (abs < 45) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "minute");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "hour");
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), "day");
  if (abs < 86400 * 365) return fmt(Math.round(abs / (86400 * 30)), "month");
  return fmt(Math.round(abs / (86400 * 365)), "year");
}

export function formatQty(value: number | string | null | undefined, unit?: QuantityUnit | null): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
  return unit ? `${rounded} ${UNIT_LABEL[unit]}` : rounded;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Converts a hex colour to "r g b" for CSS variables. */
export function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return `${(num >> 16) & 255} ${(num >> 8) & 255} ${num & 255}`;
}

export function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}
