import type { Metadata } from "next";
import { requireSuperAdmin } from "@/server/auth/context";
import { withSystem } from "@/db";
import { getOrganization, listOrganizations } from "@/server/organizations";
import { notFoundOnError } from "@/server/pages";
import { OrganizationManage } from "@/components/admin/organization-manage";

export const metadata: Metadata = { title: "Manage organization" };

export default async function OrganizationManagePage(props: PageProps<"/admin/organizations/[id]">) {
  await requireSuperAdmin();
  const { id } = await props.params;
  const { org, stats } = await notFoundOnError(() =>
    withSystem(async (tx) => ({ org: await getOrganization(tx, id), stats: (await listOrganizations(tx)).find((o) => o.id === id) })),
  );
  return (
    <OrganizationManage
      id={org.id}
      status={org.status}
      stats={{ users: stats?.userCount ?? 0, inventory: stats?.inventoryCount ?? 0, checkouts: stats?.activeCheckouts ?? 0 }}
      initial={{
        name: org.name,
        primaryColor: org.primaryColor,
        secondaryColor: org.secondaryColor,
        accentColor: org.accentColor,
        timezone: org.timezone,
        contactName: org.contactName ?? "",
        contactEmail: org.contactEmail ?? "",
        contactPhone: org.contactPhone ?? "",
        address: org.address ?? "",
        logoDataUrl: org.logoDataUrl,
      }}
    />
  );
}
