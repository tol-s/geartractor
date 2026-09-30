import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { ScanView } from "@/components/scan/scan-view";

export const metadata: Metadata = { title: "Scan" };

export default async function ScanPage() {
  await requireOrgContext("inventory.view");
  return <ScanView />;
}
