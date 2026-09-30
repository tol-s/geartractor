import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { listUsers } from "@/server/users";
import { UsersView } from "@/components/admin/users-view";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const ctx = await requireOrgContext("users.manage");
  const users = await withTenant(ctx.orgId, (tx) => listUsers(tx, ctx.orgId));
  return <UsersView users={users} selfId={ctx.user.id} orgName={ctx.org.name} />;
}
