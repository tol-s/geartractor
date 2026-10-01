"use client";

import Link from "next/link";
import type { AuditRow } from "@/server/audit-queries";
import { formatDateTime } from "@/lib/utils";
import { ACTION_LABEL } from "@/lib/audit-labels";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";


function summarise(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return String(v);
  return Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined && val !== "")
    .map(([k, val]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${Array.isArray(val) ? val.join(", ") : typeof val === "object" ? JSON.stringify(val) : String(val)}`)
    .join(" · ");
}

export function AuditTable({ rows, showEntity }: { rows: AuditRow[]; showEntity?: boolean }) {
  if (!rows.length) return <Card className="p-5 text-[14px] text-muted">No history yet.</Card>;
  return (
    <>
      <Card className="hidden overflow-hidden md:block">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[12px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-semibold">Action</th>
                {showEntity && <th className="px-3 py-3 font-semibold">Record</th>}
                <th className="px-3 py-3 font-semibold">User</th>
                <th className="px-3 py-3 font-semibold">Date/time</th>
                <th className="px-3 py-3 font-semibold">Previous</th>
                <th className="px-3 py-3 font-semibold">New</th>
                <th className="px-5 py-3 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="px-5 py-3">
                    <Badge tone="neutral">{ACTION_LABEL[r.action] ?? r.action}</Badge>
                  </td>
                  {showEntity && (
                    <td className="max-w-[200px] px-3 py-3 font-medium">
                      {r.entityId && ["component", "configuration", "kit", "consumable"].includes(r.entityType) ? (
                        <Link href={`/inventory/${r.entityId}`} className="hover:text-brand">
                          {r.entityLabel}
                        </Link>
                      ) : r.entityId && r.entityType === "checkout" ? (
                        <Link href={`/checkouts/${r.entityId}`} className="hover:text-brand">
                          {r.entityLabel}
                        </Link>
                      ) : r.entityId && r.entityType === "reservation" ? (
                        <Link href={`/reservations/${r.entityId}`} className="hover:text-brand">
                          {r.entityLabel}
                        </Link>
                      ) : (
                        r.entityLabel ?? r.entityType
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-3">{r.actorName ?? (r.actorId ? "Platform admin" : "System")}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(r.createdAt)}</td>
                  <td className="max-w-[220px] break-words px-3 py-3 text-ink-2">{summarise(r.previous)}</td>
                  <td className="max-w-[260px] break-words px-3 py-3 text-ink-2">{summarise(r.next)}</td>
                  <td className="max-w-[200px] break-words px-5 py-3 text-ink-2">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="neutral">{ACTION_LABEL[r.action] ?? r.action}</Badge>
              <span className="text-[12px] text-muted">{formatDateTime(r.createdAt)}</span>
            </div>
            {showEntity && r.entityLabel && <p className="mt-2 text-[14px] font-semibold">{r.entityLabel}</p>}
            <p className="mt-1 text-[13px] text-muted">{r.actorName ?? (r.actorId ? "Platform admin" : "System")}</p>
            {r.previous != null && <p className="mt-1 text-[13px] text-ink-2"><span className="text-muted">Previous: </span>{summarise(r.previous)}</p>}
            {r.next != null && <p className="mt-1 text-[13px] text-ink-2"><span className="text-muted">New: </span>{summarise(r.next)}</p>}
            {r.reason && <p className="mt-1 text-[13px] text-ink-2"><span className="text-muted">Reason: </span>{r.reason}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
