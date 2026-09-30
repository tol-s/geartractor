import type { Metadata } from "next";
import { requireSuperAdmin } from "@/server/auth/context";
import { withSystem } from "@/db";
import { listOrganizations, platformStats } from "@/server/organizations";
import { OrganizationsView } from "@/components/admin/organizations-view";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  await requireSuperAdmin();
  const { orgs, stats } = await withSystem(async (tx) => ({ orgs: await listOrganizations(tx), stats: await platformStats(tx) }));
  return <OrganizationsView orgs={orgs} stats={stats} />;
}
