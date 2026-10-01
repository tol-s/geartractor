import { and, eq } from "drizzle-orm";
import QRCode from "qrcode";
import type { Tx } from "@/db/tenant";
import { inventoryItems, qrCodes } from "@/db/schema";
import { newToken } from "./auth/password";

/** Each tracked record gets a stable, unguessable token. QR codes encode `${APP_URL}/q/<token>`. */
export async function ensureQrCode(tx: Tx, orgId: string, itemId: string) {
  const [existing] = await tx.select().from(qrCodes).where(eq(qrCodes.inventoryItemId, itemId));
  if (existing) return existing;
  const [row] = await tx
    .insert(qrCodes)
    .values({ organizationId: orgId, inventoryItemId: itemId, token: newToken(12) })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await tx.select().from(qrCodes).where(eq(qrCodes.inventoryItemId, itemId));
  return again;
}

export function appUrl(): string {
  const url =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

export function qrUrlForToken(token: string) {
  return `${appUrl()}/q/${token}`;
}

/**
 * Extracts a lookup key from scanned content. Accepts full QR URLs, bare tokens and
 * human-readable IDs typed manually (e.g. CPT-000031).
 */
export function parseScanInput(raw: string): { token?: string; code?: string } {
  const value = raw.trim();
  if (!value) return {};
  const match = value.match(/\/q\/([A-Za-z0-9_-]{8,64})\/?$/);
  if (match) return { token: match[1] };
  if (/^[A-Z]{2,5}-\d{1,9}$/i.test(value)) return { code: value.toUpperCase() };
  if (/^[A-Za-z0-9_-]{12,64}$/.test(value)) return { token: value };
  return { code: value.toUpperCase() };
}

export async function resolveScan(tx: Tx, orgId: string, raw: string) {
  const parsed = parseScanInput(raw);
  if (parsed.token) {
    const [row] = await tx
      .select({ id: inventoryItems.id })
      .from(qrCodes)
      .innerJoin(inventoryItems, eq(inventoryItems.id, qrCodes.inventoryItemId))
      .where(and(eq(qrCodes.token, parsed.token), eq(qrCodes.organizationId, orgId)));
    if (row) return row.id;
  }
  if (parsed.code) {
    const [row] = await tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, parsed.code)));
    if (row) return row.id;
  }
  return null;
}

export async function qrSvg(token: string): Promise<string> {
  return QRCode.toString(qrUrlForToken(token), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0B0B0F", light: "#FFFFFF" },
  });
}

export async function qrPng(token: string, size = 512): Promise<Buffer> {
  return QRCode.toBuffer(qrUrlForToken(token), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: size,
  });
}
