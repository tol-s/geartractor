import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getCheckoutDetail } from "@/server/checkout";
import { notFoundOnError } from "@/server/pages";
import { ReturnSheet } from "@/components/checkout/return-sheet";

export const metadata: Metadata = { title: "Check In" };

export default async function ReturnPage(props: PageProps<"/checkouts/[id]/return">) {
  const ctx = await requireOrgContext("checkout.create");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const detail = await notFoundOnError(() => withTenant(ctx.orgId, (tx) => getCheckoutDetail(tx, ctx, id)));
  if (detail.checkout.status !== "active" && detail.checkout.status !== "partially_returned") redirect(`/checkouts/${id}`);
  return <ReturnSheet detail={detail} focusLine={typeof sp.line === "string" ? sp.line : null} />;
}
