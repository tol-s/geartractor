import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getCheckoutDetail } from "@/server/checkout";
import { notFoundOnError } from "@/server/pages";
import { CheckoutDetailView } from "@/components/checkout/checkout-detail";

export const metadata: Metadata = { title: "Checkout Session" };

export default async function CheckoutDetailPage(props: PageProps<"/checkouts/[id]">) {
  const ctx = await requireOrgContext("checkout.create");
  const { id } = await props.params;
  const detail = await notFoundOnError(() => withTenant(ctx.orgId, (tx) => getCheckoutDetail(tx, ctx, id)));
  return <CheckoutDetailView detail={detail} canReport={ctx.can("inspection.report_issue")} />;
}
