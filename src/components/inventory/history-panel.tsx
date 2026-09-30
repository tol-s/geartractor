"use client";

import type { AuditRow } from "@/server/audit-queries";
import { STATUS_LABEL, type ItemStatus } from "@/lib/domain";
import { formatDateTime } from "@/lib/utils";
import { Card } from "../ui/card";
import { AuditTable } from "../shared/audit-table";

export function HistoryPanel({
  audit,
  statusHistory,
}: {
  audit: AuditRow[];
  statusHistory: { id: string; previousStatus: ItemStatus | null; newStatus: ItemStatus; reason: string | null; source: string; createdAt: Date; userName: string | null }[];
}) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-[16px] font-bold">Audit history</h2>
        <AuditTable rows={audit} />
      </section>
      <section>
        <h2 className="mb-3 text-[16px] font-bold">Status history</h2>
        <Card className="overflow-hidden">
          {statusHistory.length === 0 ? (
            <p className="p-5 text-[14px] text-muted">No status changes.</p>
          ) : (
            <ol className="relative space-y-0 p-5">
              {statusHistory.map((h) => (
                <li key={h.id} className="relative border-l-2 border-line pb-5 pl-5 last:pb-0">
                  <span className="absolute -left-[7px] top-1 size-3 rounded-full border-2 border-surface bg-brand" aria-hidden />
                  <p className="text-[14px] font-semibold">
                    {h.previousStatus ? `${STATUS_LABEL[h.previousStatus]} → ` : ""}
                    {STATUS_LABEL[h.newStatus]}
                  </p>
                  <p className="text-[13px] text-muted">
                    {formatDateTime(h.createdAt)} · {h.userName ?? (h.source === "system" || h.source === "daily" ? "System" : "Platform admin")} · {h.source}
                  </p>
                  {h.reason && <p className="mt-0.5 text-[13.5px] text-ink-2">{h.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>
    </div>
  );
}
