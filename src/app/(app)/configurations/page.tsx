import type { Metadata } from "next";
import { InventoryList } from "@/components/inventory/inventory-list";

export const metadata: Metadata = { title: "Configurations" };

export default async function Page(props: PageProps<"/configurations">) {
  return <InventoryList searchParams={await props.searchParams} kind="configuration" basePath="/configurations" />;
}
