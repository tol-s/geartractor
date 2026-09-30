import type { Metadata } from "next";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { sequential } from "@/db/tenant";
import { reservationItems, reservations } from "@/db/schema";
import { getInventoryDetail } from "@/server/inventory";
import { itemInspectionHistory } from "@/server/inspections";
import { itemStatusHistory, listAuditLogs } from "@/server/audit-queries";
import { listAttachments } from "@/server/attachments";
import { listMovements } from "@/server/consumables";
import { qrSvg, qrUrlForToken } from "@/server/qr";
import { notFoundOnError } from "@/server/pages";
import { ItemDetailView } from "@/components/inventory/item-detail";

export const metadata: Metadata = { title: "Equipment" };

export default async function InventoryDetailPage(props: PageProps<"/inventory/[id]">) {
  const ctx = await requireOrgContext("inventory.view");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const data = await notFoundOnError(() =>
    withTenant(ctx.orgId, async (tx) => {
      const detail = await getInventoryDetail(tx, ctx.orgId, id);
      const [inspections, statusHistory, audit, attachments, movements, upcoming] = await sequential([
        () => itemInspectionHistory(tx, ctx.orgId, id),
        () => itemStatusHistory(tx, ctx.orgId, id),
        () => listAuditLogs(tx, ctx.orgId, { entityId: id, pageSize: 100 }),
        () => listAttachments(tx, ctx.orgId, id),
        () => (detail.item.kind === "consumable" ? listMovements(tx, ctx.orgId, id) : Promise.resolve([])),
        () =>
          tx
            .select({
              id: reservations.id,
              code: reservations.code,
              eventName: reservations.eventName,
              startsAt: reservations.startsAt,
              endsAt: reservations.endsAt,
              quantity: reservationItems.quantity,
            })
            .from(reservationItems)
            .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
            .where(
              and(eq(reservationItems.inventoryItemId, id), eq(reservationItems.active, true), gt(reservationItems.endsAt, sql`now()`)),
            )
            .orderBy(asc(reservations.startsAt)),
      ] as const);
      const checkout = detail.checkedOutCode
        ? (
            await tx.execute<{ id: string; code: string; event_name: string }>(sql`
              select c.id, c.code, c.event_name from checkout_items ci join checkouts c on c.id = ci.checkout_id
              where ci.inventory_item_id = ${id} and ci.status = 'issued' limit 1`)
          ).rows[0]
        : null;
      return { detail, inspections, statusHistory, audit: audit.rows, attachments, movements, upcoming, checkout };
    }),
  );
  const qr = data.detail.qr ? { svg: await qrSvg(data.detail.qr.token), url: qrUrlForToken(data.detail.qr.token) } : null;
  return (
    <ItemDetailView
      data={data}
      qr={qr}
      tab={typeof sp.tab === "string" ? sp.tab : "overview"}
      perms={{
        manage: ctx.can("inventory.manage"),
        inspect: ctx.can("inspection.perform"),
        report: ctx.can("inspection.report_issue"),
        attachments: ctx.can("attachments.manage"),
        checkout: ctx.can("checkout.create"),
      }}
    />
  );
}
