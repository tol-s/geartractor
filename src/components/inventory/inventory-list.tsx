import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { PackagePlus, PackageSearch, ScanLine } from "lucide-react";
import { withTenant } from "@/db";
import { sequential } from "@/db/tenant";
import { inventoryItems } from "@/db/schema";
import { requireOrgContext } from "@/server/auth/context";
import { listInventory, type InventoryRow } from "@/server/inventory";
import { parseInventoryFilters, type SP } from "@/lib/inventory-filters";
import { listLocations } from "@/server/locations";
import { INVENTORY_KINDS, ITEM_STATUSES, KIND_LABEL, KIND_PLURAL, STATUS_LABEL, type InventoryKind } from "@/lib/domain";
import { cn, formatDate, formatQty } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { EmptyState } from "../shared/empty-state";
import { FilterSelect, LinkTabs, Pagination, SearchInput } from "../shared/url-controls";
import { AvailabilityBadge, KindBadge, KindIcon, StatusBadge } from "../status";
import { buttonVariants } from "../ui/button-variants";
import { RowActions } from "./row-actions";
import { ExportMenu } from "./export-menu";

export function expiryLabel(row: Pick<InventoryRow, "lifespanMode" | "computedExpiry">) {
  if (row.lifespanMode === "unlimited") return "Pending Inspection";
  return row.computedExpiry ? formatDate(row.computedExpiry) : "Missing";
}

export async function InventoryList({
  searchParams,
  kind,
  embedded,
}: {
  searchParams: SP;
  kind?: InventoryKind;
  basePath: string;
  embedded?: boolean;
}) {
  const ctx = await requireOrgContext("inventory.view");
  const filters = parseInventoryFilters(searchParams, kind);
  const { result, locations, counts } = await withTenant(ctx.orgId, async (tx) => {
    const [result, locations, counts] = await sequential([
      () => listInventory(tx, ctx.orgId, filters),
      () => listLocations(tx, ctx.orgId),
      () =>
        tx
          .select({ kind: inventoryItems.kind, n: sql<number>`count(*)::int` })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.organizationId, ctx.orgId), isNull(inventoryItems.archivedAt)))
          .groupBy(inventoryItems.kind),
    ] as const);
    return { result, locations, counts };
  });
  const countOf = (k: InventoryKind) => Number(counts.find((c) => c.kind === k)?.n ?? 0);
  const total = counts.reduce((s, c) => s + Number(c.n), 0);
  const canManage = ctx.can("inventory.manage");
  const title = kind ? KIND_PLURAL[kind] : "Inventory";
  const hasFilters = Boolean(filters.q || filters.status !== "all" || filters.locationId || filters.availability !== "all" || filters.tag);

  return (
    <div>
      {embedded ? (
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.08em]">Inventory at this location</h2>
      ) : (
        <PageHeader
          title={title}
          subtitle={kind ? subtitleFor(kind) : "Components, Configurations, Kits and Consumables"}
          actions={
            <>
              <Link href="/scan" className={buttonVariants({ variant: "secondary" })}>
                <ScanLine /> Scan QR
              </Link>
              {ctx.can("export.csv") && <ExportMenu entity="inventory" fixed={kind ? { kind } : {}} />}
              {canManage && (
                <Link
                  href={`/inventory/new${kind ? `?kind=${kind}` : filters.kind !== "all" ? `?kind=${filters.kind}` : ""}`}
                  className={buttonVariants({ variant: "brand" })}
                >
                  <PackagePlus /> Add {kind ? KIND_LABEL[kind] : "Inventory"}
                </Link>
              )}
            </>
          }
        />
      )}

      {!kind && (
        <LinkTabs
          param="kind"
          className="mb-4"
          tabs={[
            { value: "all", label: "All", count: total },
            ...INVENTORY_KINDS.map((k) => ({ value: k, label: KIND_PLURAL[k], count: countOf(k) })),
          ]}
        />
      )}

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput placeholder={`Search ${title.toLowerCase()} by ID, name, spec, tag`} className="md:max-w-sm md:flex-1" />
        <div className="no-scrollbar -mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <FilterSelect
            param="status"
            label="Status"
            options={[{ value: "all", label: "All statuses" }, ...ITEM_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
          />
          {!embedded && (
            <FilterSelect
              param="location"
              label="Location"
              options={[{ value: "all", label: "All locations" }, ...locations.map((l) => ({ value: l.id, label: l.name }))]}
            />
          )}
          <FilterSelect
            param="availability"
            label="Availability"
            options={[
              { value: "all", label: "Any availability" },
              { value: "checked_out", label: "Checked Out" },
              { value: "reserved", label: "Reserved" },
              { value: "assigned", label: "Assigned" },
              { value: "unassigned", label: "Not assigned" },
              { value: "insufficient_stock", label: "Low / Insufficient Stock" },
            ]}
          />
          <FilterSelect
            param="sort"
            label="Sort"
            options={[
              { value: "code", label: "Sort: ID" },
              { value: "name", label: "Sort: Name" },
              { value: "status", label: "Sort: Status" },
              { value: "expiry", label: "Sort: Expiry" },
              { value: "location", label: "Sort: Location" },
              { value: "updated", label: "Sort: Updated" },
            ]}
          />
        </div>
      </div>

      {result.rows.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={PackageSearch} title="No matching inventory" description="Try a different search or clear the filters." />
        ) : (
          <EmptyState
            icon={PackagePlus}
            title="No inventory yet."
            description="Add your first item to start tracking equipment."
            action={canManage ? { label: "Add Inventory", href: `/inventory/new${kind ? `?kind=${kind}` : ""}` } : undefined}
          />
        )
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                    {["ID", "Tech Spec", "Name", "Manufacturer", "Type", "Assignment", "Status", "Location", "Tags", "Qty", "Expiry"].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className={cn(
                            "whitespace-nowrap px-3 py-3 first:sticky first:left-0 first:z-10 first:bg-surface-2 first:pl-5",
                            h === "Qty" && "text-right",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                    <th scope="col" className="px-3 py-3 pr-5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id} className="group border-b border-line last:border-0 hover:bg-surface-2/80">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-surface py-3 pl-5 pr-3 font-mono text-[12.5px] font-semibold group-hover:bg-surface-2">
                        <Link href={`/inventory/${r.id}`} className="hover:text-brand">
                          {r.code}
                        </Link>
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-3 text-ink-2" title={r.techSpec ?? ""}>
                        {r.techSpec ?? <span className="text-muted">-</span>}
                      </td>
                      <td className="min-w-[170px] max-w-[220px] px-3 py-3">
                        <Link href={`/inventory/${r.id}`} className="font-semibold text-ink hover:text-brand">
                          {r.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-2">{r.manufacturer ?? <span className="text-muted">-</span>}</td>
                      <td className="px-3 py-3">
                        <KindBadge kind={r.kind} />
                      </td>
                      <td className="px-3 py-3">
                        <AssignmentCell row={r} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-2">{r.locationName}</td>
                      <td className="max-w-[160px] px-3 py-3">
                        <Tags tags={r.tags} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular font-medium">
                        <QtyCell row={r} />
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-3", expiryTone(r))}>{expiryLabel(r)}</td>
                      <td className="px-3 py-3 pr-4">
                        <RowActions id={r.id} canManage={canManage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {result.rows.map((r) => (
              <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start gap-3">
                  <KindIcon kind={r.kind} size={44} />
                  <Link href={`/inventory/${r.id}`} className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] font-semibold text-muted">{r.code}</span>
                    <span className="block truncate text-[16px] font-bold tracking-tight text-ink">{r.name}</span>
                    {r.techSpec && <span className="block truncate text-[13px] text-muted">{r.techSpec}</span>}
                  </Link>
                  <RowActions id={r.id} canManage={canManage} compact />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={r.status} />
                  <AssignmentCell row={r} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px]">
                  <div className="min-w-0">
                    <dt className="text-muted">Location</dt>
                    <dd className="truncate font-semibold text-ink-2">{r.locationName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Qty</dt>
                    <dd className="font-semibold text-ink-2 tabular">
                      <QtyCell row={r} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">Expiry</dt>
                    <dd className={cn("truncate font-semibold", expiryTone(r) || "text-ink-2")}>{expiryLabel(r)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} label="items" />
        </>
      )}
    </div>
  );
}

function subtitleFor(kind: InventoryKind) {
  return {
    component: "Individually tracked equipment",
    configuration: "Assemblies of components and consumables",
    kit: "Grab-and-go kits of gear, configurations and contents",
    consumable: "Quantity-tracked stock",
  }[kind];
}

function expiryTone(r: InventoryRow) {
  if (r.lifespanMode === "unlimited") return "text-muted";
  if (!r.computedExpiry) return "text-missing font-semibold";
  const days = (new Date(r.computedExpiry).getTime() - Date.now()) / 86400_000;
  if (days <= 0) return "text-missing font-semibold";
  if (days < 60) return "text-[#b45309] font-semibold";
  return "";
}

function AssignmentCell({ row }: { row: InventoryRow }) {
  const badges: React.ReactNode[] = [];
  if (row.parentCode)
    badges.push(
      <Link key="a" href={`/inventory/${row.parentId}`} title={`Assigned to ${row.parentName}`}>
        <AvailabilityBadge value="assigned" label={`In ${row.parentCode}`} />
      </Link>,
    );
  if (row.checkedOutCode) badges.push(<AvailabilityBadge key="c" value="checked_out" />);
  if (row.reservedUntil) badges.push(<AvailabilityBadge key="r" value="reserved" />);
  if (row.kind === "consumable" && (row.stockUnallocated ?? 0) <= 0) badges.push(<AvailabilityBadge key="s" value="insufficient_stock" />);
  if (!badges.length) return <span className="text-[13px] text-muted">Unassigned</span>;
  return <span className="flex flex-wrap gap-1">{badges}</span>;
}

function QtyCell({ row }: { row: InventoryRow }) {
  if (row.kind !== "consumable") return <>1</>;
  const low = row.reorderThreshold !== null && (row.stockUnallocated ?? 0) < (row.reorderThreshold ?? 0);
  return (
    <span className={low ? "text-[#c2410c]" : undefined} title="Unallocated / total">
      {formatQty(row.stockUnallocated ?? 0)}
      <span className="text-muted"> / {formatQty(row.stockTotal ?? 0, row.quantityUnit)}</span>
    </span>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-muted">-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, 2).map((t) => (
        <Link
          key={t}
          href={`?tag=${encodeURIComponent(t)}`}
          className="rounded-md bg-ink/[0.05] px-1.5 py-0.5 text-[11.5px] font-medium text-ink-2 hover:bg-ink/10"
        >
          {t}
        </Link>
      ))}
      {tags.length > 2 && <span className="text-[11.5px] text-muted">+{tags.length - 2}</span>}
    </span>
  );
}
