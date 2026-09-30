import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { ProfileView } from "@/components/admin/profile-view";
import { ROLE_LABEL } from "@/lib/domain";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await requireOrgContext();
  return (
    <ProfileView
      user={{
        name: ctx.user.name,
        email: ctx.user.email,
        phone: ctx.user.phone ?? "",
        notifyEmail: ctx.user.notifyEmail,
        notifyOverdue: ctx.user.notifyOverdue,
        notifyInspections: ctx.user.notifyInspections,
      }}
      orgName={ctx.org.name}
      roleLabel={ctx.isSuperAdmin ? "Platform Admin" : ROLE_LABEL[ctx.role]}
      isAdmin={ctx.can("org.settings")}
      isSuperAdmin={ctx.isSuperAdmin}
    />
  );
}
