import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { configurations, kits } from "@/db/schema";
import { listLocations } from "@/server/locations";
import { getInventoryDetail, listTags } from "@/server/inventory";
import { PageHeader } from "@/components/shared/page-header";
import { InventoryForm, type InventoryFormValues } from "@/components/inventory/inventory-form";
import { notFoundOnError } from "@/server/pages";

export const metadata: Metadata = { title: "Edit" };

export default async function EditInventoryPage(props: PageProps<"/inventory/[id]/edit">) {
  const ctx = await requireOrgContext("inventory.manage");
  const { id } = await props.params;
  const data = await notFoundOnError(() =>
    withTenant(ctx.orgId, async (tx) => {
      const detail = await getInventoryDetail(tx, ctx.orgId, id);
      const locations = await listLocations(tx, ctx.orgId);
      const tags = await listTags(tx, ctx.orgId);
      let purpose: string | null = null;
      if (detail.item.kind === "configuration") purpose = (await tx.select().from(configurations).where(eq(configurations.inventoryItemId, id)))[0]?.purpose ?? null;
      if (detail.item.kind === "kit") purpose = (await tx.select().from(kits).where(eq(kits.inventoryItemId, id)))[0]?.purpose ?? null;
      return { detail, locations, tags, purpose };
    }),
  );
  const i = data.detail.item;
  const initial: InventoryFormValues = {
    kind: i.kind,
    name: i.name,
    serialNumber: i.serialNumber ?? "",
    techSpec: i.techSpec ?? "",
    manufacturer: i.manufacturer ?? "",
    locationId: i.locationId ?? "",
    status: i.status,
    statusReason: "",
    manufactureDate: i.manufactureDate ?? "",
    firstUseDate: i.firstUseDate ?? "",
    lifespanMode: i.lifespanMode,
    lifespanMonths: i.lifespanMonths?.toString() ?? "",
    expiryBasis: i.expiryBasis ?? "",
    explicitExpiry: i.explicitExpiry ?? "",
    annualInspectionRequired: i.annualInspectionRequired,
    inspectionIntervalMonths: String(i.inspectionIntervalMonths),
    lastInspectionDate: i.lastInspectionDate ?? "",
    nextInspectionDate: i.nextInspectionDate ?? "",
    lastUseDate: i.lastUseDate ?? "",
    technicalDetails: i.technicalDetails ?? "",
    notes: i.notes ?? "",
    tags: data.detail.tags.map((t) => t.name),
    quantityUnit: i.quantityUnit ?? "",
    reorderThreshold: i.reorderThreshold?.toString() ?? "",
    initialQuantity: "",
    purpose: data.purpose ?? "",
  };
  const locations = data.locations.filter((l) => l.isActive || l.id === i.locationId);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${i.code}`} subtitle={i.name} back={{ href: `/inventory/${id}`, label: i.code }} />
      <InventoryForm mode="edit" itemId={id} initial={initial} locations={locations} knownTags={data.tags.map((t) => t.name)} />
    </div>
  );
}
