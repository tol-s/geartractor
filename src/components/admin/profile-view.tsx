"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, Building2, ChartColumn, ChevronRight, KeyRound, LogOut, MapPin, Palette, Settings2, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { changePasswordAction, updateProfileAction } from "@/app/actions/admin";
import { signOutAction } from "@/app/actions/session";
import { useAction } from "@/hooks/use-action";
import { Card } from "../ui/card";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/input";
import { Switch } from "../ui/controls";
import { ErrorPanel } from "../shared/error-panel";

type Profile = { name: string; email: string; phone: string; notifyEmail: boolean; notifyOverdue: boolean; notifyInspections: boolean };

export function ProfileView({ user, orgName, roleLabel, isAdmin, isSuperAdmin }: { user: Profile; orgName: string; roleLabel: string; isAdmin: boolean; isSuperAdmin: boolean }) {
  const [p, setP] = React.useState(user);
  const save = useAction(updateProfileAction, { success: "Profile saved" });
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const change = useAction(changePasswordAction, { success: "Password changed", onSuccess: () => setPw({ current: "", next: "", confirm: "" }) });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
        <Avatar name={p.name} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-bold tracking-tight">{user.name}</h1>
          <p className="text-[14px] text-muted">{user.email}</p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-2 sm:justify-start">
            <Building2 className="size-4" /> {orgName} · {roleLabel}
          </p>
        </div>
        <form action={signOutAction}>
          <Button variant="danger-outline" type="submit">
            <LogOut /> Sign out
          </Button>
        </form>
      </Card>

      {(isAdmin || isSuperAdmin) && (
        <Card className="divide-y divide-line">
          {[
            ...(isAdmin
              ? [
                  { href: "/settings", label: "Organization Branding", icon: Palette },
                  { href: "/locations", label: "Locations", icon: MapPin },
                  { href: "/users", label: "Users", icon: UsersRound },
                  { href: "/settings#inventory", label: "Inventory Settings", icon: Settings2 },
                  { href: "/reports", label: "Reports & audit history", icon: ChartColumn },
                ]
              : []),
            ...(isSuperAdmin ? [{ href: "/admin/organizations", label: "Platform: Organizations", icon: ShieldCheck }] : []),
          ].map((l) => (
            <Link key={l.href} href={l.href} className="flex min-h-14 items-center gap-3 px-5 hover:bg-surface-2">
              <l.icon className="size-5 text-muted" />
              <span className="flex-1 text-[14.5px] font-semibold">{l.label}</span>
              <ChevronRight className="size-5 text-muted" />
            </Link>
          ))}
        </Card>
      )}

      <section id="settings" className="space-y-6">
        <Card className="space-y-4 p-5 md:p-6">
          <h2 className="flex items-center gap-2 text-[16px] font-bold">
            <UserRound className="size-5 text-brand" /> Personal Information
          </h2>
          <ErrorPanel error={save.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="p-name">
              <Input id="p-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="p-phone">
              <Input id="p-phone" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} inputMode="tel" />
            </Field>
            <Field label="Email" htmlFor="p-email" hint="Contact an administrator to change your email.">
              <Input id="p-email" value={p.email} disabled />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button loading={save.pending} onClick={() => save.run({ ...p, phone: p.phone || null })}>
              Save
            </Button>
          </div>
        </Card>

        <Card className="space-y-4 p-5 md:p-6">
          <h2 className="flex items-center gap-2 text-[16px] font-bold">
            <KeyRound className="size-5 text-brand" /> Password
          </h2>
          <ErrorPanel error={change.error} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Current password" htmlFor="pw-cur">
              <Input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="pw-new" hint="10+ characters, letters and numbers.">
              <Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Confirm" htmlFor="pw-conf" error={pw.confirm && pw.confirm !== pw.next ? "Passwords do not match" : undefined}>
              <Input id="pw-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button loading={change.pending} disabled={!pw.current || !pw.next || pw.next !== pw.confirm} onClick={() => change.run(pw.current, pw.next)}>
              Change password
            </Button>
          </div>
        </Card>

        <Card className="divide-y divide-line">
          <h2 className="flex items-center gap-2 p-5 text-[16px] font-bold">
            <Bell className="size-5 text-brand" /> Notifications
          </h2>
          {[
            { k: "notifyEmail" as const, t: "Email notifications", d: "Invitations, resets and account notices." },
            { k: "notifyOverdue" as const, t: "Overdue returns", d: "Remind me when my checkouts are overdue." },
            { k: "notifyInspections" as const, t: "Inspection alerts", d: "Tell me when equipment needs inspection." },
          ].map((n) => (
            <label key={n.k} className="flex cursor-pointer items-center justify-between gap-4 p-5">
              <span>
                <span className="block text-[14.5px] font-semibold">{n.t}</span>
                <span className="block text-[13px] text-muted">{n.d}</span>
              </span>
              <Switch
                checked={p[n.k]}
                onCheckedChange={(c) => {
                  const next = { ...p, [n.k]: c };
                  setP(next);
                  save.run({ ...next, phone: next.phone || null });
                }}
                aria-label={n.t}
              />
            </label>
          ))}
        </Card>
      </section>
    </div>
  );
}
