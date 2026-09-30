"use client";

import * as React from "react";
import { LogIn, Power } from "lucide-react";
import { setOrganizationStatusAction, updateOrganizationAction } from "@/app/actions/admin";
import { enterOrganizationAction } from "@/app/actions/session";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ConfirmDialog } from "../ui/dialog";
import { BrandingForm, type BrandingValues } from "./org-settings";

export function OrganizationManage({
  id,
  status,
  stats,
  initial,
}: {
  id: string;
  status: "active" | "inactive";
  stats: { users: number; inventory: number; checkouts: number };
  initial: BrandingValues;
}) {
  const save = useAction(updateOrganizationAction, { success: "Organization updated" });
  const setStatus = useAction(setOrganizationStatusAction, { success: status === "active" ? "Organization deactivated" : "Organization activated" });
  const enter = useAction(enterOrganizationAction, { refresh: false });
  const [confirm, setConfirm] = React.useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin/organizations", label: "Organizations" }}
        eyebrow={
          <Badge tone={status === "active" ? "green" : "neutral"} dot>
            {status === "active" ? "Active" : "Inactive"}
          </Badge>
        }
        title={initial.name}
        subtitle={`${stats.users} users · ${stats.inventory} inventory items · ${stats.checkouts} active checkouts`}
        actions={
          <>
            <Button variant={status === "active" ? "danger-outline" : "secondary"} onClick={() => setConfirm(true)}>
              <Power /> {status === "active" ? "Deactivate" : "Activate"}
            </Button>
            <Button disabled={status !== "active"} loading={enter.pending} onClick={() => enter.run(id)}>
              <LogIn /> Enter organization
            </Button>
          </>
        }
      />
      <BrandingForm initial={initial} onSave={(v) => save.run(id, v)} pending={save.pending} error={save.error} submitLabel="Save organization" />
      <Card className="p-5 text-[13.5px] text-muted">
        Entering an organization is recorded in its audit history. Deactivating signs out all of its members and blocks access until reactivated. Data is never deleted.
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={status === "active" ? `Deactivate ${initial.name}?` : `Activate ${initial.name}?`}
        description={status === "active" ? "All members are signed out and cannot sign in until reactivated." : "Members can sign in again."}
        confirmLabel={status === "active" ? "Deactivate" : "Activate"}
        tone={status === "active" ? "danger" : "primary"}
        loading={setStatus.pending}
        onConfirm={() => setStatus.run(id, status === "active" ? "inactive" : "active").then(() => setConfirm(false))}
      />
    </div>
  );
}
