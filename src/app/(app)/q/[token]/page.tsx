import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { withTenant } from "@/db";
import { resolveScan } from "@/server/qr";
import { EmptyState } from "@/components/shared/empty-state";
import { QrCode } from "lucide-react";

/** Stable QR target: resolves the token within the signed-in organization only. */
export default async function QrResolvePage(props: PageProps<"/q/[token]">) {
  const ctx = await requireOrgContext("inventory.view");
  const { token } = await props.params;
  const id = await withTenant(ctx.orgId, (tx) => resolveScan(tx, ctx.orgId, `/q/${token}`));
  if (id) redirect(`/inventory/${id}?scanned=1`);
  return (
    <EmptyState
      icon={QrCode}
      title="QR code not recognised"
      description="This code does not belong to any equipment in your organization."
      action={{ label: "Open scanner", href: "/scan" }}
    />
  );
}
