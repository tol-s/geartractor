import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listLocations, locationStats } from "@/server/locations";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { LocationActions } from "@/components/admin/location-dialog";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  const ctx = await requireOrgContext("inventory.view");
  const { locations, stats } = await withTenant(ctx.orgId, async (tx) => ({
    locations: await listLocations(tx, ctx.orgId),
    stats: await locationStats(tx, ctx.orgId),
  }));
  return (
    <div>
      <PageHeader title="Locations" subtitle="Where equipment is stored" actions={ctx.can("locations.manage") ? <LocationActions mode="create" /> : null} />
      {locations.length === 0 ? (
        <EmptyState icon={MapPin} title="No locations yet." description="Add a storage location to start adding inventory." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {locations.map((l) => {
            const s = stats.get(l.id);
            return (
              <li key={l.id}>
                <Link href={`/locations/${l.id}`} className="group block h-full rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-reserve/10 text-reserve">
                      <MapPin className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[16px] font-bold tracking-tight">
                        {l.name} {!l.isActive && <Badge>Inactive</Badge>}
                      </p>
                      <p className="truncate text-[13px] text-muted">{l.description ?? l.code ?? ""}</p>
                    </div>
                    <ChevronRight className="size-5 text-muted" />
                  </div>
                  <dl className="mt-4 grid grid-cols-5 gap-1 text-center">
                    {[
                      { label: "Total", v: s?.total ?? 0, c: "text-ink" },
                      { label: "Available", v: s?.available ?? 0, c: "text-available" },
                      { label: "Out", v: s?.checkedOut ?? 0, c: "text-checked-out" },
                      { label: "Inspect", v: s?.needsInspection ?? 0, c: "text-inspection" },
                      { label: "Missing", v: s?.missing ?? 0, c: "text-missing" },
                    ].map((x) => (
                      <div key={x.label} className="rounded-xl bg-surface-2 py-2">
                        <dd className={`text-[18px] font-bold tabular ${x.c}`}>{x.v}</dd>
                        <dt className="text-[10.5px] font-semibold uppercase text-muted">{x.label}</dt>
                      </div>
                    ))}
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
