import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { requireSuperAdmin } from "@/server/auth/context";
import { withSystem } from "@/db";
import { listSuperAdmins } from "@/server/organizations";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Platform Settings" };

export default async function PlatformSettingsPage() {
  await requireSuperAdmin();
  const { admins, db } = await withSystem(async (tx) => {
    const admins = await listSuperAdmins(tx);
    const r = await tx.execute<{ bypass: boolean; role: string }>(sql`select rolbypassrls as bypass, current_user as role from pg_roles where rolname = current_user`);
    return { admins, db: r.rows[0] };
  });
  const checks = [
    { label: "Row-level security enforced for app role", ok: !db.bypass, detail: `Connected as ${db.role}${db.bypass ? " (BYPASSRLS: tenant isolation relies on application checks only)" : ""}` },
    { label: "Transactional email provider", ok: Boolean(process.env.RESEND_API_KEY), detail: process.env.RESEND_API_KEY ? "Resend configured" : "Not configured: invitation/reset links are shown to admins and logged" },
    { label: "Scheduled status refresh", ok: Boolean(process.env.CRON_SECRET), detail: process.env.CRON_SECRET ? "CRON_SECRET set (daily /api/cron/refresh-status)" : "CRON_SECRET missing; statuses still refresh on first visit each day" },
    { label: "Public app URL", ok: Boolean(process.env.APP_URL), detail: process.env.APP_URL ?? "APP_URL not set (QR codes default to localhost)" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Platform Settings" subtitle="Platform configuration and super administrators" />
      <Card className="divide-y divide-line">
        {checks.map((c) => (
          <div key={c.label} className="flex items-start gap-3 p-5">
            {c.ok ? <CheckCircle2 className="mt-0.5 size-5 text-available" /> : <CircleAlert className="mt-0.5 size-5 text-inspection" />}
            <div>
              <p className="text-[14.5px] font-semibold">{c.label}</p>
              <p className="text-[13px] text-muted">{c.detail}</p>
            </div>
          </div>
        ))}
      </Card>
      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.08em]">Super administrators</h2>
        <Card className="divide-y divide-line">
          {admins.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-4">
              <Avatar name={a.name} size={38} />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">{a.name}</p>
                <p className="text-[12.5px] text-muted">{a.email}</p>
              </div>
              <span className="text-[12.5px] text-muted">{a.lastActiveAt ? `Active ${timeAgo(a.lastActiveAt)}` : "Never active"}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
