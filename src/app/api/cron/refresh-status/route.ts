import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db";
import { organizations } from "@/db/schema";
import { recomputeOrgStatuses } from "@/server/status-engine";
import { purgeStaleUploads } from "@/server/attachments";

export const dynamic = "force-dynamic";

/** Daily job (Vercel Cron): refreshes time-based statuses (expiry, inspection due) for every tenant. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgs = await withSystem((tx) => tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.status, "active")));
  let updated = 0;
  for (const org of orgs) {
    const res = await withTenant(org.id, (tx) => recomputeOrgStatuses(tx, org.id, { source: "daily" }));
    updated += res.updated;
  }
  await withSystem((tx) => purgeStaleUploads(tx));
  return NextResponse.json({ ok: true, organizations: orgs.length, updated });
}
