import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listCheckouts } from "@/server/checkout";
import { CheckInHub } from "@/components/checkout/check-in-hub";

export const metadata: Metadata = { title: "Check In" };

export default async function CheckInPage() {
  const ctx = await requireOrgContext("checkout.create");
  const res = await withTenant(ctx.orgId, (tx) => listCheckouts(tx, ctx, { status: "active", pageSize: 100 }));
  return <CheckInHub sessions={res.rows} />;
}
