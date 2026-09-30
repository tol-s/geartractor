import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getItemOrThrow } from "@/server/inventory";
import { PageHeader } from "@/components/shared/page-header";
import { StartCheckoutForm } from "@/components/checkout/start-form";

export const metadata: Metadata = { title: "Start Checkout" };

export default async function NewCheckoutPage(props: PageProps<"/checkouts/new">) {
  const ctx = await requireOrgContext("checkout.create");
  const sp = await props.searchParams;
  const itemId = typeof sp.item === "string" && /^[0-9a-f-]{36}$/i.test(sp.item) ? sp.item : undefined;
  const item = itemId ? await withTenant(ctx.orgId, (tx) => getItemOrThrow(tx, ctx.orgId, itemId)).catch(() => null) : null;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Start Checkout" subtitle="Take equipment out in four quick steps." back={{ href: "/dashboard", label: "Dashboard" }} />
      <StartCheckoutForm defaultDays={ctx.org.settings?.defaultCheckoutDays ?? 7} itemId={item?.id} itemLabel={item ? `${item.code} ${item.name}` : undefined} />
    </div>
  );
}
