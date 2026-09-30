import { INVENTORY_KINDS, ITEM_STATUSES, type InventoryKind } from "./domain";
import type { InventoryFilters } from "@/server/inventory";

export type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export function parseInventoryFilters(sp: SP, fixedKind?: InventoryKind): InventoryFilters {
  const kind = fixedKind ?? (INVENTORY_KINDS.includes(str(sp.kind) as InventoryKind) ? (str(sp.kind) as InventoryKind) : "all");
  const status = ITEM_STATUSES.includes(str(sp.status) as never) ? (str(sp.status) as InventoryFilters["status"]) : "all";
  const sort = ["code", "name", "status", "expiry", "updated", "location"].includes(str(sp.sort) ?? "") ? (str(sp.sort) as InventoryFilters["sort"]) : "code";
  return {
    q: str(sp.q)?.slice(0, 100),
    kind,
    status,
    locationId: /^[0-9a-f-]{36}$/i.test(str(sp.location) ?? "") ? str(sp.location) : undefined,
    availability: (["checked_out", "reserved", "assigned", "unassigned", "insufficient_stock"].includes(str(sp.availability) ?? "")
      ? str(sp.availability)
      : "all") as InventoryFilters["availability"],
    tag: str(sp.tag)?.slice(0, 40),
    sort,
    dir: str(sp.dir) === "desc" ? "desc" : "asc",
    page: Math.max(1, Number(str(sp.page) ?? 1) || 1),
    archived: str(sp.archived) === "1",
  };
}

