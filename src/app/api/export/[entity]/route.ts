import { withTenant } from "@/db";
import { withRouteContext } from "@/server/http";
import { iterateInventory, type InventoryFilters } from "@/server/inventory";
import { listCheckouts } from "@/server/checkout";
import { listReservations } from "@/server/reservations";
import { listAuditLogs } from "@/server/audit-queries";
import { parseInventoryFilters } from "@/lib/inventory-filters";
import { CSV_BOM, csvDate, csvLine } from "@/lib/csv";
import { CHECKOUT_STATUS_LABEL, KIND_LABEL, RESERVATION_STATUS_LABEL, STATUS_LABEL, type InventoryKind } from "@/lib/domain";
import { isoDateInZone } from "@/lib/utils";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

/**
 * UTF-8 CSV exports. "filtered" honours the current search, filters and sort; "all" exports
 * every record. All matching rows are exported (paged server-side), never only the visible page.
 */
export async function GET(req: Request, ctxArg: RouteContext<"/api/export/[entity]">) {
  const { entity } = await ctxArg.params;
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const scope = sp.scope === "all" ? "all" : "filtered";
  return withRouteContext("export.csv", async (ctx) => {
    const stamp = isoDateInZone(new Date(), ctx.org.timezone);
    const lines: string[] = [CSV_BOM];
    let name = entity;
    await withTenant(ctx.orgId, async (tx) => {
      if (entity === "inventory") {
        const fixedKind = ["component", "configuration", "kit", "consumable"].includes(sp.kind ?? "") && scope === "all" ? (sp.kind as InventoryKind) : undefined;
        const filters: InventoryFilters = scope === "all" ? { kind: fixedKind ?? "all", sort: "code" } : parseInventoryFilters(sp);
        name = fixedKind ? `${fixedKind}s` : "inventory";
        lines.push(csvLine(["ID", "Tech Spec", "Name", "Manufacturer", "Type", "Assignment", "Status", "Location", "Tags", "Qty", "Unit", "Expiry", "Serial Number", "Checked Out", "Status Reasons"]));
        for await (const r of iterateInventory(tx, ctx.orgId, filters)) {
          lines.push(
            csvLine([
              r.code,
              r.techSpec,
              r.name,
              r.manufacturer,
              KIND_LABEL[r.kind],
              r.parentCode ? `Assigned to ${KIND_LABEL[r.parentKind!]} ${r.parentCode}` : "Unassigned",
              STATUS_LABEL[r.status],
              r.locationName,
              r.tags,
              r.kind === "consumable" ? (r.stockTotal ?? 0) : 1,
              r.kind === "consumable" ? r.quantityUnit : "",
              r.lifespanMode === "unlimited" ? "Pending Inspection" : csvDate(r.computedExpiry) || "Missing",
              r.serialNumber,
              r.checkedOutCode ?? "",
              (r.reasons ?? []).map((x) => x.label),
            ]),
          );
        }
      } else if (entity === "checkouts") {
        lines.push(csvLine(["Session ID", "Event", "Status", "Trainer/User", "Location", "Started", "Due", "Completed", "Items out", "Items total"]));
        const status = scope === "all" ? "all" : ((sp.status as "active" | "draft" | "returned" | "overdue" | undefined) ?? "all");
        for (let page = 1; ; page++) {
          const res = await listCheckouts(tx, ctx, { status, q: scope === "all" ? undefined : sp.q, page, pageSize: 100 });
          for (const r of res.rows)
            lines.push(csvLine([r.code, r.eventName, CHECKOUT_STATUS_LABEL[r.status], r.userName, r.locationName, csvDate(r.startedAt), csvDate(r.dueAt), csvDate(r.completedAt), r.itemsOut, r.itemsTotal]));
          if (page >= res.pageCount) break;
        }
      } else if (entity === "reservations") {
        lines.push(csvLine(["Reservation ID", "Event", "Status", "User", "Location", "Start", "End", "Items"]));
        const sc = scope === "all" ? "all" : ((sp.scope_filter as "upcoming" | "past" | "cancelled" | undefined) ?? (sp.tab as "upcoming" | "past" | "cancelled" | undefined) ?? "upcoming");
        for (let page = 1; ; page++) {
          const res = await listReservations(tx, ctx, { scope: sc, q: scope === "all" ? undefined : sp.q, page });
          for (const r of res.rows)
            lines.push(csvLine([r.code, r.eventName, RESERVATION_STATUS_LABEL[r.status], r.userName, r.locationName, csvDate(r.startsAt), csvDate(r.endsAt), r.itemCount]));
          if (page >= res.pageCount) break;
        }
      } else if (entity === "audit") {
        if (!ctx.can("audit.view")) throw new AppError("Not allowed", "You cannot export the audit history.", "forbidden");
        lines.push(csvLine(["Date", "Time", "Action", "Record", "User", "Previous", "New", "Reason"]));
        for (let page = 1; ; page++) {
          const res = await listAuditLogs(tx, ctx.orgId, { action: scope === "all" ? undefined : sp.action, q: scope === "all" ? undefined : sp.q, page, pageSize: 200 });
          for (const r of res.rows)
            lines.push(
              csvLine([
                csvDate(r.createdAt),
                r.createdAt.toISOString().slice(11, 19),
                r.action,
                r.entityLabel ?? r.entityType,
                r.actorName ?? (r.actorId ? "Platform admin" : "System"),
                r.previous ? JSON.stringify(r.previous) : "",
                r.next ? JSON.stringify(r.next) : "",
                r.reason,
              ]),
            );
          if (page >= res.pageCount) break;
        }
      } else {
        throw new AppError("Unknown export", "This export does not exist.", "not_found");
      }
    });
    return new Response(lines.join(""), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="gear-tractor-${name}-${scope}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
