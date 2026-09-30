import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withSystem } from "@/db";
import { getOrganization } from "@/server/organizations";
import { OrgSettingsView } from "@/components/admin/org-settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireOrgContext("org.settings");
  const org = await withSystem((tx) => getOrganization(tx, ctx.orgId));
  return (
    <OrgSettingsView
      org={{
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
      settings={{
        trainersCanInspect: Boolean(org.settings.trainersCanInspect),
        allowReservedOverride: Boolean(org.settings.allowReservedOverride),
        defaultCheckoutDays: org.settings.defaultCheckoutDays ?? 7,
      }}
    />
  );
}
