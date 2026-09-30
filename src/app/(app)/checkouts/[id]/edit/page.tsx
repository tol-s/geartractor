import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getCheckoutDetail } from "@/server/checkout";
import { listAssignableUsers } from "@/server/users";
import { listLocations, locationStats } from "@/server/locations";
import { getItemOrThrow } from "@/server/inventory";
import { notFoundOnError } from "@/server/pages";
import { CheckoutWizard } from "@/components/checkout/wizard";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutWizardPage(props: PageProps<"/checkouts/[id]/edit">) {
  const ctx = await requireOrgContext("checkout.create");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const data = await notFoundOnError(() =>
    withTenant(ctx.orgId, async (tx) => {
      const detail = await getCheckoutDetail(tx, ctx, id);
      const users = ctx.can("checkout.assign_user") ? await listAssignableUsers(tx, ctx.orgId) : [];
      const locations = await listLocations(tx, ctx.orgId, { activeOnly: true });
      const stats = await locationStats(tx, ctx.orgId);
      const itemParam = typeof sp.item === "string" && /^[0-9a-f-]{36}$/i.test(sp.item) ? sp.item : null;
      const pending = itemParam ? await getItemOrThrow(tx, ctx.orgId, itemParam).catch(() => null) : null;
      return { detail, users, locations: locations.map((l) => ({ ...l, stats: stats.get(l.id) ?? null })), pending };
    }),
  );
  if (data.detail.checkout.status !== "draft") redirect(`/checkouts/${id}`);
  const stepParam = Number(sp.step);
  const step = stepParam >= 1 && stepParam <= 5 ? Math.min(stepParam, data.detail.checkout.currentStep === 4 ? 5 : data.detail.checkout.currentStep) : data.detail.checkout.currentStep;
  return (
    <CheckoutWizard
      detail={data.detail}
      initialStep={step}
      users={data.users}
      self={{ id: ctx.user.id, name: ctx.user.name, email: ctx.user.email }}
      canAssign={ctx.can("checkout.assign_user")}
      canOverride={ctx.can("reservation.override") && Boolean(ctx.org.settings?.allowReservedOverride)}
      locations={data.locations}
      pendingItem={data.pending ? { id: data.pending.id, code: data.pending.code, name: data.pending.name, locationId: data.pending.locationId } : null}
    />
  );
}
