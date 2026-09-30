"use client";

import Link from "next/link";
import { ClipboardCheck, Eye, MoreHorizontal, Pencil, PackageOpen, QrCode } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";

export function RowActions({ id, canManage, compact }: { id: string; canManage: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {!compact && (
        <>
          <Link href={`/inventory/${id}`} className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))} aria-label="View">
            <Eye />
          </Link>
          {canManage && (
            <Link href={`/inventory/${id}/edit`} className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))} aria-label="Edit">
              <Pencil />
            </Link>
          )}
        </>
      )}
      <Menu>
        <MenuTrigger className={cn(buttonVariants({ variant: "ghost", size: compact ? "icon" : "icon-sm" }))} aria-label="More actions">
          <MoreHorizontal />
        </MenuTrigger>
        <MenuContent>
          <MenuItem asChild>
            <Link href={`/inventory/${id}`}>
              <Eye /> View
            </Link>
          </MenuItem>
          {canManage && (
            <MenuItem asChild>
              <Link href={`/inventory/${id}/edit`}>
                <Pencil /> Edit
              </Link>
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem asChild>
            <Link href={`/checkouts/new?item=${id}`}>
              <PackageOpen /> Add to Checkout
            </Link>
          </MenuItem>
          <MenuItem asChild>
            <Link href={`/inspections/new?root=${id}`}>
              <ClipboardCheck /> Inspect
            </Link>
          </MenuItem>
          <MenuItem asChild>
            <Link href={`/inventory/${id}?tab=qr`}>
              <QrCode /> QR code
            </Link>
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
