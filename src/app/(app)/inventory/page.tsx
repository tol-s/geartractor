import type { Metadata } from "next";
import { InventoryList } from "@/components/inventory/inventory-list";

export const metadata: Metadata = { title: "Inventory" };

export default async function Page(props: PageProps<"/inventory">) {
  return <InventoryList searchParams={await props.searchParams} basePath="/inventory" />;
}
