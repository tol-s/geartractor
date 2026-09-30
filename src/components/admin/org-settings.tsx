"use client";

import * as React from "react";
import Link from "next/link";
import { ImagePlus, MapPin, PackageOpen, CalendarPlus, PackageCheck, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { saveBrandingAction, saveOrgSettingsAction } from "@/app/actions/admin";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { ErrorPanel } from "../shared/error-panel";
import { Card } from "../ui/card";
import { Button, buttonVariants } from "../ui/button";
import { Field, Input, NativeSelect } from "../ui/input";
import { Switch } from "../ui/controls";
import { LogoMark } from "../shell/logo";
import { cn, isHexColor } from "@/lib/utils";

export type BrandingValues = {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  timezone: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  logoDataUrl: string | null;
};

export const TIMEZONES = [
  "UTC",
  "America/Edmonton",
  "America/Vancouver",
  "America/Toronto",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function BrandingForm({ initial, onSave, pending, error, submitLabel = "Save branding" }: {
  initial: BrandingValues;
  onSave: (v: BrandingValues) => void;
  pending: boolean;
  error: Parameters<typeof ErrorPanel>[0]["error"];
  submitLabel?: string;
}) {
  const [v, setV] = React.useState(initial);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const set = <K extends keyof BrandingValues>(k: K, val: BrandingValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const onLogo = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type)) return toast.error("Unsupported logo", { description: "Use PNG, JPG, SVG or WebP." });
    if (f.size > 200_000) return toast.error("Logo too large", { description: "Logos must be smaller than 200KB." });
    const reader = new FileReader();
    reader.onload = () => set("logoDataUrl", String(reader.result));
    reader.readAsDataURL(f);
  };
  const colors: [keyof BrandingValues, string, string][] = [
    ["primaryColor", "Primary (Checkout)", "Main brand colour and checkout actions"],
    ["secondaryColor", "Secondary (Reserve)", "Reservation actions"],
    ["accentColor", "Accent (Check In)", "Check-in actions"],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="space-y-5 p-5 md:p-6">
        <ErrorPanel error={error} />
        <div className="flex items-center gap-4">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-2">
            {v.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.logoDataUrl} alt="Organization logo" className="size-full object-contain" />
            ) : (
              <span style={{ ["--brand" as string]: v.primaryColor }}>
                <LogoMark size={44} />
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus /> Upload logo
            </Button>
            {v.logoDataUrl && (
              <Button variant="ghost" size="sm" onClick={() => set("logoDataUrl", null)}>
                <Trash2 /> Remove
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
          </div>
        </div>
        <Field label="Organization name" htmlFor="org-name" required>
          <Input id="org-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          {colors.map(([k, label, hint]) => (
            <Field key={k} label={label} htmlFor={`c-${k}`} hint={hint} error={!isHexColor(String(v[k])) ? "Use a hex colour" : undefined}>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={isHexColor(String(v[k])) ? String(v[k]) : "#000000"}
                  onChange={(e) => set(k, e.target.value as never)}
                  className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-line-2 bg-surface p-1"
                  aria-label={`${label} picker`}
                />
                <Input id={`c-${k}`} value={String(v[k])} onChange={(e) => set(k, e.target.value as never)} className="font-mono" />
              </div>
            </Field>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Timezone" htmlFor="org-tz" hint="Used for expiry and inspection due dates.">
            <NativeSelect id="org-tz" value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {Array.from(new Set([v.timezone, ...TIMEZONES])).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Contact name" htmlFor="org-cn">
            <Input id="org-cn" value={v.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="Contact email" htmlFor="org-ce">
            <Input id="org-ce" type="email" value={v.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
          </Field>
          <Field label="Contact phone" htmlFor="org-cp">
            <Input id="org-cp" value={v.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
          </Field>
        </div>
        <Field label="Address" htmlFor="org-addr">
          <Input id="org-addr" value={v.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button loading={pending} onClick={() => onSave(v)} disabled={!v.name.trim()}>
            {submitLabel}
          </Button>
        </div>
      </Card>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Preview</p>
        <div className="space-y-2" style={{ ["--brand" as string]: v.primaryColor, ["--brand-2" as string]: v.secondaryColor, ["--brand-3" as string]: v.accentColor }}>
          {[
            { label: "Check Out Gear", icon: PackageOpen, bg: v.primaryColor },
            { label: "Reserve Gear", icon: CalendarPlus, bg: v.secondaryColor },
            { label: "Check In Gear", icon: PackageCheck, bg: v.accentColor },
          ].map((t) => (
            <div key={t.label} className="flex items-center gap-3 rounded-[22px] p-4 text-white" style={{ background: t.bg }}>
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/20">
                <t.icon className="size-5" />
              </span>
              <span className="text-[15px] font-extrabold uppercase">{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrgSettingsView({
  org,
  settings,
}: {
  org: BrandingValues;
  settings: { trainersCanInspect: boolean; allowReservedOverride: boolean; defaultCheckoutDays: number };
}) {
  const branding = useAction(saveBrandingAction, { success: "Branding saved" });
  const [s, setS] = React.useState(settings);
  const saveSettings = useAction(saveOrgSettingsAction, { success: "Settings saved" });
  return (
    <div className="space-y-8">
      <PageHeader title="Organization Settings" subtitle="Branding is applied across the app for everyone in your organization." />
      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.08em]">Organization Branding</h2>
        <BrandingForm initial={org} onSave={(v) => branding.run(v)} pending={branding.pending} error={branding.error} />
      </section>
      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.08em]">Inventory Settings</h2>
        <Card className="divide-y divide-line">
          {[
            { k: "trainersCanInspect" as const, title: "Trainers can record inspections", desc: "Otherwise trainers can only report issues (flag for inspection)." },
            { k: "allowReservedOverride" as const, title: "Allow reservation override", desc: "Admins may explicitly check out equipment reserved for another session, with a reason." },
          ].map((row) => (
            <label key={row.k} className="flex cursor-pointer items-center justify-between gap-4 p-5">
              <span>
                <span className="block text-[14.5px] font-semibold">{row.title}</span>
                <span className="block text-[13px] text-muted">{row.desc}</span>
              </span>
              <Switch checked={s[row.k]} onCheckedChange={(c) => setS({ ...s, [row.k]: c })} aria-label={row.title} />
            </label>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <span>
              <span className="block text-[14.5px] font-semibold">Default checkout length</span>
              <span className="block text-[13px] text-muted">Days until a checkout is considered overdue.</span>
            </span>
            <Input
              type="number"
              min={1}
              max={365}
              value={s.defaultCheckoutDays}
              onChange={(e) => setS({ ...s, defaultCheckoutDays: Number(e.target.value) })}
              className="w-24"
              aria-label="Default checkout days"
            />
          </div>
          <div className="flex justify-end p-4">
            <Button loading={saveSettings.pending} onClick={() => saveSettings.run(s)}>
              Save settings
            </Button>
          </div>
        </Card>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <Link href="/locations" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "justify-start")}>
          <MapPin /> Manage locations
        </Link>
        <Link href="/users" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "justify-start")}>
          <UsersRound /> Manage users
        </Link>
      </section>
    </div>
  );
}
