import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth/session";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role === "super_admin" && !session.activeOrganizationId) redirect("/admin/organizations");
  redirect("/dashboard");
}
