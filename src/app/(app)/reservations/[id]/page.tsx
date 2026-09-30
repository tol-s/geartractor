import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getReservationDetail } from "@/server/reservations";
import { notFoundOnError } from "@/server/pages";
import { ReservationDetailView } from "@/components/reservations/reservation-detail";

export const metadata: Metadata = { title: "Reservation" };

export default async function ReservationPage(props: PageProps<"/reservations/[id]">) {
  const ctx = await requireOrgContext("reservation.create");
  const { id } = await props.params;
  const data = await notFoundOnError(() => withTenant(ctx.orgId, (tx) => getReservationDetail(tx, ctx, id)));
  return <ReservationDetailView data={data} />;
}
