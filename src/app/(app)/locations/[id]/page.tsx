import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { getLocation, locationStats } from "@/server/locations";
import { notFoundOnError } from "@/server/pages";
import { InventoryList } from "@/components/inventory/inventory-list";
import { PageHeader } from "@/components/shared/page-header";
import { LocationActions } from "@/components/admin/location-dialog";

export const metadata: Metadata = { title: "Location" };

export default async function LocationPage(props: PageProps<"/locations/[id]">) {
  const ctx = await requireOrgContext("inventory.view");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { loc, stats } = await notFoundOnError(() =>
    withTenant(ctx.orgId, async (tx) => ({ loc: await getLocation(tx, ctx.orgId, id), stats: (await locationStats(tx, ctx.orgId)).get(id) })),
  );
  return (
    <div>
      <PageHeader
        back={{ href: "/locations", label: "Locations" }}
        title={loc.name}
        subtitle={[loc.code, loc.address, loc.description].filter(Boolean).join(" · ") || undefined}
        actions={
          ctx.can("locations.manage") ? (
            <LocationActions mode="edit" id={loc.id} initial={{ name: loc.name, code: loc.code ?? "", description: loc.description ?? "", address: loc.address ?? "", isActive: loc.isActive }} />
          ) : null
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Total inventory", v: stats?.total ?? 0, c: "text-ink" },
          { label: "Available", v: stats?.available ?? 0, c: "text-available" },
          { label: "Checked Out", v: stats?.checkedOut ?? 0, c: "text-checked-out" },
          { label: "Needs Inspection", v: stats?.needsInspection ?? 0, c: "text-[#b45309]" },
          { label: "Missing", v: stats?.missing ?? 0, c: "text-missing" },
        ].map((x) => (
          <div key={x.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{x.label}</p>
            <p className={`mt-1 text-[28px] font-bold tabular ${x.c}`}>{x.v}</p>
          </div>
        ))}
      </div>
      <InventoryList searchParams={{ ...sp, location: id }} basePath={`/locations/${id}`} embedded />
    </div>
  );
}
