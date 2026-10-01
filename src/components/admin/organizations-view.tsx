"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, ChevronRight, Copy, LogIn, Plus } from "lucide-react";
import { createOrganizationAction } from "@/app/actions/admin";
import { enterOrganizationAction } from "@/app/actions/session";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { BrandingForm, type BrandingValues } from "./org-settings";

type Org = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  primaryColor: string;
  logoDataUrl: string | null;
  createdAt: Date;
  userCount: number;
  inventoryCount: number;
  activeCheckouts: number;
};

export function OrganizationsView({
  orgs,
  stats,
}: {
  orgs: Org[];
  stats: { totalOrganizations: number; activeOrganizations: number; totalUsers: number; totalInventory: number };
}) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    // "Create organization" in the organization switcher links here with ?new=1.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("new") === "1") setOpen(true);
  }, []);
  const [admin, setAdmin] = React.useState({ name: "", email: "" });
  const [invite, setInvite] = React.useState<string | null>(null);
  const create = useAction(createOrganizationAction, {
    success: "Organization created",
    onSuccess: (r) => {
      setOpen(false);
      setInvite(r.inviteUrl);
    },
  });
  const enter = useAction(enterOrganizationAction, { refresh: false });
  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Every tenant is fully isolated at the database level."
        actions={
          <Button variant="brand" onClick={() => setOpen(true)}>
            <Plus /> Create Organization
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total Organizations", v: stats.totalOrganizations },
          { label: "Active Organizations", v: stats.activeOrganizations },
          { label: "Total Users", v: stats.totalUsers },
          { label: "Total Inventory", v: stats.totalInventory },
        ].map((s) => (
          <Card key={s.label} className="p-5">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{s.label}</p>
            <p className="mt-1 text-[30px] font-bold tabular">{s.v}</p>
          </Card>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {orgs.map((o) => (
          <li key={o.id}>
            <Card className="flex h-full flex-col p-5">
              <div className="flex items-start gap-3">
                {o.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.logoDataUrl} alt="" className="size-12 rounded-2xl border border-line object-contain" />
                ) : (
                  <span className="flex size-12 items-center justify-center rounded-2xl text-white" style={{ background: o.primaryColor }}>
                    <Building2 className="size-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-bold tracking-tight">{o.name}</p>
                  <p className="text-[12.5px] text-muted">
                    /{o.slug} · Created {formatDate(o.createdAt)}
                  </p>
                </div>
                <Badge tone={o.status === "active" ? "green" : "neutral"} dot>
                  {o.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { l: "Users", v: o.userCount },
                  { l: "Inventory", v: o.inventoryCount },
                  { l: "Out now", v: o.activeCheckouts },
                ].map((x) => (
                  <div key={x.l} className="rounded-xl bg-surface-2 py-2">
                    <dd className="text-[18px] font-bold tabular">{x.v}</dd>
                    <dt className="text-[11px] font-semibold uppercase text-muted">{x.l}</dt>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" className="flex-1" disabled={o.status !== "active"} loading={enter.pending} onClick={() => enter.run(o.id)}>
                  <LogIn /> Enter
                </Button>
                <Link href={`/admin/organizations/${o.id}`} className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-line-2 text-[14px] font-semibold hover:bg-surface-2">
                  Manage <ChevronRight className="size-4" />
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog open={open} onOpenChange={setOpen} title="Create Organization" description="A Main Warehouse location and an Organization Admin invitation are created automatically." size="xl">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Admin name" htmlFor="adm-name" required>
              <Input id="adm-name" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
            </Field>
            <Field label="Admin email" htmlFor="adm-email" required>
              <Input id="adm-email" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
            </Field>
          </div>
          <BrandingForm
            initial={
              {
                name: "",
                primaryColor: "#FF6B1A",
                secondaryColor: "#2563EB",
                accentColor: "#E11D74",
                timezone: "UTC",
                contactName: "",
                contactEmail: "",
                contactPhone: "",
                address: "",
                logoDataUrl: null,
              } satisfies BrandingValues
            }
            pending={create.pending}
            error={create.error}
            submitLabel="Create organization"
            onSave={(v) => create.run({ ...v, adminName: admin.name, adminEmail: admin.email })}
          />
        </div>
      </Dialog>
      <Dialog open={Boolean(invite)} onOpenChange={(o) => !o && setInvite(null)} title="Admin invitation" description="Share this one-time link with the organization admin (valid for 7 days)." size="sm">
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
          <code className="min-w-0 flex-1 truncate text-[12.5px]">{invite}</code>
          <Button size="sm" onClick={() => invite && navigator.clipboard?.writeText(invite).then(() => toast.success("Link copied", { id: "org-invite" }))}>
            <Copy /> Copy
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
