import type { Metadata } from "next";
import { InventoryList } from "@/components/inventory/inventory-list";

export const metadata: Metadata = { title: "Kits" };

export default async function Page(props: PageProps<"/kits">) {
  return <InventoryList searchParams={await props.searchParams} kind="kit" basePath="/kits" />;
}
