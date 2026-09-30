import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listLocations } from "@/server/locations";
import { listAssignableUsers } from "@/server/users";
import { ReservationWizard } from "@/components/reservations/reservation-wizard";

export const metadata: Metadata = { title: "Reserve Gear" };

export default async function NewReservationPage() {
  const ctx = await requireOrgContext("reservation.create");
  const { locations, users } = await withTenant(ctx.orgId, async (tx) => ({
    locations: await listLocations(tx, ctx.orgId, { activeOnly: true }),
    users: ctx.can("reservation.manage_all") ? await listAssignableUsers(tx, ctx.orgId) : [],
  }));
  return (
    <ReservationWizard
      locations={locations}
      users={users}
      self={{ id: ctx.user.id, name: ctx.user.name }}
      canAssign={ctx.can("reservation.manage_all")}
    />
  );
}
