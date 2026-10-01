"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  Boxes,
  Building2,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  Droplets,
  House,
  Layers,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, type Role } from "@/lib/domain";
import { Avatar } from "../ui/avatar";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu";
import { OrgSwitcher, type SwitcherOrg } from "./org-switcher";
import { PLATFORM_ORG_ID } from "./platform";
import { leaveOrganizationAction, signOutAction } from "@/app/actions/session";

export type ShellProps = {
  user: { name: string; email: string; role: Role };
  org: { id: string; name: string; logo: string | null };
  orgs: SwitcherOrg[];
  isSuperAdmin: boolean;
  allowed: string[];
  children: React.ReactNode;
};

type NavItem = { href: string; label: string; icon: LucideIcon; match?: string[] };

const NAV_SECTIONS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Equipment",
    items: [
      { href: "/inventory", label: "Inventory", icon: Package, match: ["/inventory", "/print"] },
      { href: "/configurations", label: "Configurations", icon: Layers },
      { href: "/kits", label: "Kits", icon: Boxes },
      { href: "/consumables", label: "Consumables", icon: Droplets },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/checkouts", label: "Checkouts", icon: PackageCheck, match: ["/checkouts", "/check-in"] },
      { href: "/reservations", label: "Reservations", icon: CalendarClock },
      { href: "/inspections", label: "Inspections", icon: ClipboardCheck },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/locations", label: "Locations", icon: MapPin },
      { href: "/users", label: "Users", icon: UsersRound },
      { href: "/reports", label: "Reports", icon: ChartColumn },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/settings", label: "Platform Settings", icon: ShieldCheck },
];

const TITLES: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/inventory", "Inventory"],
  ["/configurations", "Configurations"],
  ["/kits", "Kits"],
  ["/consumables", "Consumables"],
  ["/checkouts", "Checkouts"],
  ["/check-in", "Check In"],
  ["/reservations", "Reservations"],
  ["/inspections", "Inspections"],
  ["/locations", "Locations"],
  ["/users", "Users"],
  ["/reports", "Reports"],
  ["/settings", "Settings"],
  ["/profile", "Profile"],
  ["/activity", "Activity"],
  ["/scan", "Scan"],
  ["/admin", "Platform"],
];

function isActive(pathname: string, item: NavItem) {
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ user, org, orgs, isSuperAdmin, allowed, children }: ShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      // Restore a per-viewer preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem("gt:sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("gt:sidebar", c ? "expanded" : "collapsed");
      } catch {}
      return !c;
    });
  };
  const sections = NAV_SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter((n) => allowed.includes(n.href)) })).filter(
    (sec) => sec.items.length > 0,
  );
  const switcher = { orgs, currentId: org.id, role: user.role, isSuperAdmin, canSettings: allowed.includes("/settings") };
  const title = TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? "Gear Tractor";
  const hideChrome = pathname.startsWith("/scan");

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 80 : 272 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface lg:flex"
        aria-label="Primary"
      >
        <div className={cn("p-3 pt-4", collapsed && "flex justify-center px-0")}>
          <OrgSwitcher {...switcher} variant={collapsed ? "collapsed" : "sidebar"} />
        </div>
        <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4 pt-1">
          {sections.map((sec, i) => (
            <div key={sec.label ?? i} className={cn(i > 0 && "mt-5")}>
              {sec.label &&
                (collapsed ? (
                  <div className="mx-auto mb-2 h-px w-8 bg-line" aria-hidden />
                ) : (
                  <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{sec.label}</p>
                ))}
              <ul className="space-y-0.5">
                {sec.items.map((item) => (
                  <SideLink key={item.href} item={item} active={isActive(pathname, item)} collapsed={collapsed} />
                ))}
              </ul>
            </div>
          ))}
          {isSuperAdmin && (
            <div className="mt-5">
              {collapsed ? (
                <div className="mx-auto mb-2 h-px w-8 bg-line" aria-hidden />
              ) : (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Platform</p>
              )}
              <ul className="space-y-0.5">
                {ADMIN_NAV.map((item) => (
                  <SideLink key={item.href} item={item} active={isActive(pathname, item)} collapsed={collapsed} />
                ))}
              </ul>
            </div>
          )}
        </nav>
        <div className="border-t border-line p-3">
          <button
            onClick={toggle}
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-muted hover:bg-ink/5 hover:text-ink",
              collapsed && "justify-center px-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </motion.aside>

      <div className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[80px]" : "lg:pl-[272px]")}>
        {/* Desktop top bar */}
        <header className="sticky top-0 z-30 hidden h-[72px] items-center justify-between border-b border-line/70 bg-canvas/85 px-8 backdrop-blur-xl lg:flex">
          <div className="flex items-center gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
            {isSuperAdmin && org.id !== PLATFORM_ORG_ID && (
              <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white">Platform admin · {org.name}</span>
            )}
          </div>
          <ProfileMenu user={user} org={org} isSuperAdmin={isSuperAdmin} />
        </header>

        {/* Mobile top bar */}
        {!hideChrome && (
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line/60 bg-canvas/85 px-4 backdrop-blur-xl lg:hidden">
            <OrgSwitcher {...switcher} variant="mobile" />
            <ProfileMenu user={user} org={org} isSuperAdmin={isSuperAdmin} compact />
          </header>
        )}

        <main
          className={cn(
            "mx-auto w-full max-w-[1240px] px-4 pb-32 pt-5 sm:px-6 md:pt-7 lg:px-8 lg:pb-16",
            hideChrome && "max-w-none px-0 pb-0 pt-0 sm:px-0 lg:px-0",
          )}
        >
          {children}
        </main>
      </div>

      {!hideChrome && <BottomNav pathname={pathname} />}
    </div>
  );
}

function SideLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors",
          active ? "bg-ink/[0.06] font-semibold text-ink" : "font-medium text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
          collapsed && "justify-center px-0",
        )}
      >
        <Icon className={cn("size-[19px] shrink-0", active ? "text-brand" : "text-muted")} strokeWidth={active ? 2.3 : 1.9} aria-hidden />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    </li>
  );
}

function ProfileMenu({
  user,
  org,
  isSuperAdmin,
  compact,
}: {
  user: ShellProps["user"];
  org: ShellProps["org"];
  isSuperAdmin: boolean;
  compact?: boolean;
}) {
  return (
    <Menu>
      <MenuTrigger
        className="flex items-center gap-3 rounded-full p-1 pr-1 outline-none transition-colors hover:bg-ink/5 data-[state=open]:bg-ink/5 md:pr-3"
        aria-label="Open profile menu"
      >
        <Avatar name={user.name} size={compact ? 38 : 40} />
        {!compact && (
          <span className="hidden text-left md:block">
            <span className="block text-[14px] font-semibold leading-tight">{user.name}</span>
            <span className="block text-[12px] text-muted">{isSuperAdmin ? "Platform Admin" : ROLE_LABEL[user.role]}</span>
          </span>
        )}
      </MenuTrigger>
      <MenuContent className="w-64">
        <div className="flex items-center gap-3 px-3 pb-2 pt-2.5">
          <Avatar name={user.name} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{user.name}</p>
            <p className="truncate text-[12px] text-muted">{user.email}</p>
          </div>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/profile">
            <UserRound /> Profile
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/settings">
            <Building2 /> Organization
            <span className="ml-auto max-w-[96px] truncate text-[12px] text-muted">{org.name}</span>
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/profile#settings">
            <Settings /> Settings
          </Link>
        </MenuItem>
        {isSuperAdmin && (
          <>
            <MenuSeparator />
            <MenuLabel>Platform</MenuLabel>
            <MenuItem asChild>
              <Link href="/admin/organizations">
                <ShieldCheck /> All organizations
              </Link>
            </MenuItem>
            <MenuItem onSelect={() => leaveOrganizationAction()}>
              <Building2 /> Leave {org.name}
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem onSelect={() => signOutAction()} className="text-missing data-[highlighted]:text-missing [&_svg]:!text-missing">
          <LogOut /> Sign Out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

const BOTTOM: { href: string; label: string; icon: LucideIcon; match: string[] }[] = [
  { href: "/dashboard", label: "Home", icon: House, match: ["/dashboard"] },
  { href: "/inventory", label: "Inventory", icon: Package, match: ["/inventory", "/configurations", "/kits", "/consumables", "/locations"] },
  { href: "/scan", label: "Scan", icon: ScanLine, match: ["/scan"] },
  { href: "/activity", label: "Activity", icon: Activity, match: ["/activity", "/checkouts", "/check-in", "/reservations", "/inspections"] },
  { href: "/profile", label: "Profile", icon: UserRound, match: ["/profile", "/settings", "/users", "/reports", "/admin"] },
];

function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-surface/90 backdrop-blur-xl lg:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto grid h-[68px] max-w-lg grid-cols-5 items-center px-2">
        {BOTTOM.map((item) => {
          const active = item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          const Icon = item.icon;
          if (item.href === "/scan") {
            return (
              <li key={item.href} className="flex justify-center">
                <Link
                  href="/scan"
                  aria-label="Scan QR code"
                  className="-mt-7 flex size-[62px] items-center justify-center rounded-[22px] bg-brand text-white ring-[5px] ring-canvas transition-transform active:scale-95"
                >
                  <ScanLine className="size-7" strokeWidth={2.2} />
                </Link>
              </li>
            );
          }
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-[60px] flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition-colors",
                  active ? "text-ink" : "text-muted",
                )}
              >
                <Icon className={cn("size-[22px]", active && "text-brand")} strokeWidth={active ? 2.3 : 1.9} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
