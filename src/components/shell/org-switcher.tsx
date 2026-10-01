"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings, ShieldCheck } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, type Role } from "@/lib/domain";
import { switchOrganizationAction } from "@/app/actions/session";
import { PLATFORM_ORG_ID } from "./platform";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu";

export type SwitcherOrg = { id: string; name: string; logo: string | null; color: string; role: Role; status: "active" | "inactive" };

export function OrgAvatar({ org, size = 36 }: { org: Pick<SwitcherOrg, "name" | "logo" | "color">; size?: number }) {
  if (org.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={org.logo}
        alt=""
        className="shrink-0 rounded-[10px] border border-line bg-white object-contain p-0.5"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] font-bold text-white"
      style={{ width: size, height: size, background: org.color, fontSize: size * 0.42 }}
      aria-hidden
    >
      {org.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

const roleText = (r: Role) => (r === "super_admin" ? "Platform Admin" : ROLE_LABEL[r]);

export function OrgSwitcher({
  orgs,
  currentId,
  role,
  isSuperAdmin,
  canSettings,
  variant,
}: {
  orgs: SwitcherOrg[];
  currentId: string;
  role: Role;
  isSuperAdmin: boolean;
  canSettings: boolean;
  variant: "sidebar" | "collapsed" | "mobile";
}) {
  // Platform admins can also return to the platform console, which has no tenant.
  const list: SwitcherOrg[] = isSuperAdmin
    ? [{ id: PLATFORM_ORG_ID, name: "Platform console", logo: null, color: "#0b0b0f", role: "super_admin", status: "active" }, ...orgs]
    : orgs;
  const current = list.find((o) => o.id === currentId) ?? list[0];
  const [pending, setPending] = React.useState<string | null>(null);

  const choose = async (id: string) => {
    if (id === currentId || pending) return;
    setPending(id);
    const res = await switchOrganizationAction(id);
    if (res.ok) {
      // Full load: clears the client router cache so no page from the previous tenant is reused.
      window.location.assign(res.data.href);
      return;
    }
    toast.error(res.error.message);
    setPending(null);
  };

  if (!current) return null;
  return (
    <M.Root>
      <M.Trigger
        className={cn(
          "group flex min-w-0 items-center outline-none transition-colors",
          variant === "sidebar" &&
            "w-full gap-3 rounded-2xl border border-line bg-surface p-2 pr-3 text-left hover:border-line-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40 data-[state=open]:border-line-2 data-[state=open]:bg-surface-2",
          variant === "collapsed" && "justify-center rounded-xl p-1 hover:bg-ink/5 data-[state=open]:bg-ink/5",
          variant === "mobile" && "gap-2.5 rounded-xl py-1 pl-1 pr-2 text-left hover:bg-ink/5 data-[state=open]:bg-ink/5",
        )}
        aria-label={`Organization: ${current.name}. Switch organization`}
      >
        <OrgAvatar org={current} size={variant === "mobile" ? 34 : 38} />
        {variant !== "collapsed" && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-bold leading-tight tracking-[-0.01em] text-ink">{current.name}</span>
              <span className="block truncate text-[12px] font-medium text-muted">{roleText(role)}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted transition-colors group-hover:text-ink" aria-hidden />
          </>
        )}
      </M.Trigger>
      <MenuContent align="start" className="w-[288px]" side={variant === "collapsed" ? "right" : "bottom"}>
        <MenuLabel>Switch organization</MenuLabel>
        <div className="max-h-[320px] overflow-y-auto">
          {list.map((o) => {
            const active = o.id === currentId;
            return (
              <MenuItem
                key={o.id}
                onSelect={(e) => {
                  e.preventDefault();
                  void choose(o.id);
                }}
                className={cn("min-h-[52px] gap-3 py-1.5", active && "bg-ink/[0.04]")}
                aria-current={active ? "true" : undefined}
              >
                <OrgAvatar org={o} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{o.name}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {o.id === PLATFORM_ORG_ID ? "All organizations" : o.status === "inactive" ? "Inactive" : roleText(o.role)}
                  </span>
                </span>
                {pending === o.id ? (
                  <Loader2 className="animate-spin" aria-label="Switching" />
                ) : active ? (
                  <span className="grid size-5 place-items-center rounded-full bg-brand text-white">
                    <Check className="!size-3 !text-white" strokeWidth={3} aria-label="Current organization" />
                  </span>
                ) : null}
              </MenuItem>
            );
          })}
        </div>
        {(canSettings || isSuperAdmin) && <MenuSeparator />}
        {canSettings && (
          <MenuItem asChild>
            <Link href="/settings">
              <Settings /> Organization settings
            </Link>
          </MenuItem>
        )}
        {isSuperAdmin && (
          <>
            <MenuItem asChild>
              <Link href="/admin/organizations">
                <ShieldCheck /> Manage organizations
              </Link>
            </MenuItem>
            <MenuItem asChild>
              <Link href="/admin/organizations?new=1">
                <Plus /> Create organization
              </Link>
            </MenuItem>
          </>
        )}
        {!isSuperAdmin && orgs.length === 1 && (
          <p className="flex items-start gap-2 px-3 pb-2 pt-1 text-[12px] leading-snug text-muted">
            <Building2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Other organizations appear here when an admin gives you access.
          </p>
        )}
      </MenuContent>
    </M.Root>
  );
}
