"use client";

import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { buttonVariants } from "../ui/button";

/** CSV export of filtered results (search, filters and sort) or of everything. */
export function ExportMenu({ entity, fixed = {} }: { entity: string; fixed?: Record<string, string> }) {
  const params = useSearchParams();
  const filtered = new URLSearchParams(params.toString());
  filtered.delete("page");
  for (const [k, v] of Object.entries(fixed)) filtered.set(k, v);
  const all = new URLSearchParams(fixed);
  all.set("scope", "all");
  filtered.set("scope", "filtered");
  return (
    <Menu>
      <MenuTrigger className={buttonVariants({ variant: "secondary" })}>
        <Download /> <span className="hidden sm:inline">Export CSV</span>
      </MenuTrigger>
      <MenuContent>
        <MenuItem asChild>
          <a href={`/api/export/${entity}?${filtered.toString()}`} download>
            <Download /> Export Filtered
          </a>
        </MenuItem>
        <MenuItem asChild>
          <a href={`/api/export/${entity}?${all.toString()}`} download>
            <Download /> Export All
          </a>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
