"use client";

import * as React from "react";
import { saveLocationAction } from "@/app/actions/admin";
import { useAction } from "@/hooks/use-action";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Textarea } from "../ui/input";
import { Switch } from "../ui/controls";
import { ErrorPanel } from "../shared/error-panel";

export type LocationValues = { name: string; code: string; description: string; address: string; isActive: boolean };

export function LocationDialog({
  open,
  onOpenChange,
  id,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  id: string | null;
  initial?: Partial<LocationValues>;
}) {
  const [v, setV] = React.useState<LocationValues>({ name: "", code: "", description: "", address: "", isActive: true, ...initial });
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setV({ name: "", code: "", description: "", address: "", isActive: true, ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useAction(saveLocationAction, { success: id ? "Location updated" : "Location created", onSuccess: () => onOpenChange(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={id ? "Edit location" : "Add location"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.pending} disabled={!v.name.trim()} onClick={() => save.run(id, v)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorPanel error={save.error} />
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="Name" htmlFor="loc-name" required>
            <Input id="loc-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Code" htmlFor="loc-code">
            <Input id="loc-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
          </Field>
        </div>
        <Field label="Description" htmlFor="loc-desc">
          <Textarea id="loc-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
        <Field label="Address" htmlFor="loc-addr">
          <Input id="loc-addr" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </Field>
        {id && (
          <label className="flex items-center justify-between rounded-2xl border border-line px-4 py-3">
            <span className="text-[14px] font-semibold">Active</span>
            <Switch checked={v.isActive} onCheckedChange={(c) => setV({ ...v, isActive: c })} aria-label="Active" />
          </label>
        )}
      </div>
    </Dialog>
  );
}

export function LocationActions({ id, initial, mode }: { id?: string; initial?: Partial<LocationValues>; mode: "create" | "edit" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={mode === "create" ? "brand" : "secondary"} onClick={() => setOpen(true)}>
        {mode === "create" ? "Add Location" : "Edit"}
      </Button>
      <LocationDialog open={open} onOpenChange={setOpen} id={id ?? null} initial={initial} />
    </>
  );
}
