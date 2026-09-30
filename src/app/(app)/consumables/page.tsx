import type { Metadata } from "next";
import { InventoryList } from "@/components/inventory/inventory-list";

export const metadata: Metadata = { title: "Consumables" };

export default async function Page(props: PageProps<"/consumables">) {
  return <InventoryList searchParams={await props.searchParams} kind="consumable" basePath="/consumables" />;
}
