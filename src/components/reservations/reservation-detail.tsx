"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarX2, Clock, MapPin, PackageOpen, UserRound } from "lucide-react";
import { KIND_LABEL, RESERVATION_STATUS_LABEL } from "@/lib/domain";
import { formatDateTime, formatQty } from "@/lib/utils";
import { cancelReservationAction } from "@/app/actions/reservations";
import { startFromReservationAction } from "@/app/actions/checkout";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { KindIcon, StatusBadge } from "../status";
import type { InventoryKind, ItemStatus, QuantityUnit } from "@/lib/domain";

type Data = {
  reservation: { id: string; code: string; eventName: string; startsAt: Date; endsAt: Date; status: "confirmed" | "cancelled" | "fulfilled"; notes: string | null };
  locationName: string | null;
  userName: string | null;
  items: { id: string; itemId: string; code: string; name: string; kind: InventoryKind; status: ItemStatus; unit: QuantityUnit | null; quantity: number; active: boolean }[];
  checkout: { id: string; code: string; status: string } | null;
};

export function ReservationDetailView({ data }: { data: Data }) {
  const r = data.reservation;
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const cancel = useAction(cancelReservationAction, { success: "Reservation cancelled", onSuccess: () => setCancelOpen(false) });
  const start = useAction(startFromReservationAction, { refresh: false });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: "/reservations", label: "Reservations" }}
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-muted">{r.code}</span>
            <Badge tone={r.status === "confirmed" ? "purple" : r.status === "fulfilled" ? "green" : "neutral"} dot>
              {RESERVATION_STATUS_LABEL[r.status]}
            </Badge>
          </span>
        }
        title={r.eventName}
        actions={
          r.status === "confirmed" ? (
            <>
              <Button variant="danger-outline" onClick={() => setCancelOpen(true)}>
                <CalendarX2 /> Cancel
              </Button>
              <Button variant="brand" loading={start.pending} onClick={() => start.run(r.id)}>
                <PackageOpen /> Start Checkout
              </Button>
            </>
          ) : data.checkout ? (
            <Link href={`/checkouts/${data.checkout.id}`} className="inline-flex h-11 items-center rounded-xl border border-line-2 bg-surface px-4 text-[14px] font-semibold">
              Open {data.checkout.code}
            </Link>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="divide-y divide-line">
          {data.items.map((i) => (
            <Link key={i.id} href={`/inventory/${i.itemId}`} className="flex items-center gap-3 p-4 hover:bg-surface-2">
              <KindIcon kind={i.kind} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[12px] text-muted">{i.code}</span>
                <span className="block truncate text-[14px] font-semibold">{i.name}</span>
                <span className="block text-[12.5px] text-muted">{KIND_LABEL[i.kind]}</span>
              </span>
              {i.kind === "consumable" ? <span className="text-[13px] font-semibold">{formatQty(i.quantity, i.unit)}</span> : <StatusBadge status={i.status} />}
            </Link>
          ))}
        </Card>
        <Card className="space-y-4 p-5">
          {[
            { label: "Start", value: formatDateTime(r.startsAt), icon: Clock },
            { label: "End", value: formatDateTime(r.endsAt), icon: Clock },
            { label: "Location", value: data.locationName, icon: MapPin },
            { label: "User", value: data.userName, icon: UserRound },
          ].map((d) => (
            <div key={d.label} className="flex gap-3">
              <d.icon className="mt-0.5 size-4 text-muted" />
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{d.label}</p>
                <p className="text-[14px] font-medium">{d.value}</p>
              </div>
            </div>
          ))}
          {r.notes && <p className="rounded-xl bg-surface-2 p-3 text-[13.5px]">{r.notes}</p>}
        </Card>
      </div>
      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${r.code}?`}
        description="The equipment is released for other sessions."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep
            </Button>
            <Button variant="danger" loading={cancel.pending} onClick={() => cancel.run(r.id, reason || null)}>
              Cancel reservation
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="cancel-reason">
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
