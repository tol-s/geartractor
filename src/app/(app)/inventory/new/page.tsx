import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listLocations } from "@/server/locations";
import { listTags } from "@/server/inventory";
import { INVENTORY_KINDS, KIND_LABEL, type InventoryKind } from "@/lib/domain";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { InventoryForm } from "@/components/inventory/inventory-form";
import { emptyInventoryValues } from "@/lib/inventory-form-values";
import { MapPin } from "lucide-react";

export const metadata: Metadata = { title: "Add Inventory" };

export default async function NewInventoryPage(props: PageProps<"/inventory/new">) {
  const ctx = await requireOrgContext("inventory.manage");
  const sp = await props.searchParams;
  const kind: InventoryKind = INVENTORY_KINDS.includes(sp.kind as InventoryKind) ? (sp.kind as InventoryKind) : "component";
  const { locations, tags } = await withTenant(ctx.orgId, async (tx) => ({
    locations: await listLocations(tx, ctx.orgId, { activeOnly: true }),
    tags: await listTags(tx, ctx.orgId),
  }));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Add ${sp.kind ? KIND_LABEL[kind] : "Inventory"}`} subtitle="A QR code is generated automatically." back={{ href: "/inventory", label: "Inventory" }} />
      {locations.length === 0 ? (
        <EmptyState icon={MapPin} title="Add a storage location first" description="Every item needs a storage location." action={{ label: "Add Location", href: "/locations" }} />
      ) : (
        <InventoryForm
          mode="create"
          initial={emptyInventoryValues(kind, locations[0].id)}
          locations={locations}
          knownTags={tags.map((t) => t.name)}
          lockedKind={Boolean(sp.kind)}
        />
      )}
    </div>
  );
}
