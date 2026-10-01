"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, MailPlus, MoreHorizontal, RotateCcw, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { ROLE_LABEL, type Role } from "@/lib/domain";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { inviteUserAction, resendInviteAction, updateUserAction } from "@/app/actions/admin";
import { useAction } from "@/hooks/use-action";
import { PageHeader } from "../shared/page-header";
import { ErrorPanel } from "../shared/error-panel";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Avatar } from "../ui/avatar";
import { Button, buttonVariants } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, NativeSelect } from "../ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";

type U = { id: string; name: string; email: string; role: Role; status: "active" | "invited" | "deactivated"; lastActiveAt: Date | null; createdAt: Date; inviteExpiresAt: string | null };

export function UsersView({ users, selfId, orgName }: { users: U[]; selfId: string; orgName: string }) {
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [link, setLink] = React.useState<{ url: string; emailed: boolean; email: string } | null>(null);
  const update = useAction(updateUserAction, { success: "User updated" });
  const resend = useAction(resendInviteAction, {
    onSuccess: (r) => setLink({ url: r.inviteUrl, emailed: r.emailed, email: "" }),
    success: "Invitation renewed",
  });
  const statusTone = { active: "green", invited: "amber", deactivated: "neutral" } as const;
  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`People with access to ${orgName}`}
        actions={
          <Button variant="brand" onClick={() => setInviteOpen(true)}>
            <MailPlus /> Invite user
          </Button>
        }
      />
      <Card className="relative hidden overflow-hidden md:block">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-[12px] uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-3 py-3 font-semibold">Email</th>
              <th className="px-3 py-3 font-semibold">Role</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Last Active</th>
              <th className="px-5 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3 font-semibold">
                    <Avatar name={u.name} size={34} /> {u.name}
                    {u.id === selfId && <span className="text-[12px] font-medium text-muted">(you)</span>}
                  </span>
                </td>
                <td className="px-3 py-3 text-ink-2">{u.email}</td>
                <td className="px-3 py-3">{ROLE_LABEL[u.role]}</td>
                <td className="px-3 py-3">
                  <Badge tone={statusTone[u.status]} dot>
                    {u.status === "invited" ? "Invited" : u.status === "active" ? "Active" : "Deactivated"}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-muted" title={u.lastActiveAt ? formatDateTime(u.lastActiveAt) : undefined}>
                  {u.lastActiveAt ? timeAgo(u.lastActiveAt) : "Never"}
                </td>
                <td className="px-5 py-3 text-right">
                  <UserMenu u={u} self={u.id === selfId} onUpdate={update.run} onResend={resend.run} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="space-y-2 md:hidden">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <Avatar name={u.name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{u.name}</p>
              <p className="truncate text-[12.5px] text-muted">{u.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone[u.status]} dot>
                  {u.status}
                </Badge>
                <span className="text-[12px] text-muted">{ROLE_LABEL[u.role]} · {u.lastActiveAt ? timeAgo(u.lastActiveAt) : "Never active"}</span>
              </div>
            </div>
            <UserMenu u={u} self={u.id === selfId} onUpdate={update.run} onResend={resend.run} />
          </li>
        ))}
      </ul>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={setLink} />
      <Dialog
        open={Boolean(link)}
        onOpenChange={(o) => !o && setLink(null)}
        title="Invitation ready"
        description={link?.emailed ? "We emailed the invitation. You can also share this link directly." : "Share this secure link with the user. It expires in 7 days and can only be used once."}
        size="sm"
      >
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
          <code className="min-w-0 flex-1 truncate text-[12.5px]">{link?.url}</code>
          <Button
            size="sm"
            onClick={() => link && navigator.clipboard?.writeText(link.url).then(() => toast.success("Link copied", { id: "invite-copy" }))}
          >
            <Copy /> Copy
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function UserMenu({
  u,
  self,
  onUpdate,
  onResend,
}: {
  u: U;
  self: boolean;
  onUpdate: (id: string, input: { role?: "org_admin" | "trainer"; status?: "active" | "deactivated" }) => unknown;
  onResend: (id: string) => unknown;
}) {
  if (self) return null;
  return (
    <Menu>
      <MenuTrigger className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Actions for ${u.name}`}>
        <MoreHorizontal />
      </MenuTrigger>
      <MenuContent>
        {u.role === "trainer" ? (
          <MenuItem onSelect={() => onUpdate(u.id, { role: "org_admin" })}>
            <ShieldCheck /> Make Organization Admin
          </MenuItem>
        ) : (
          <MenuItem onSelect={() => onUpdate(u.id, { role: "trainer" })}>
            <UserCheck /> Make Trainer/User
          </MenuItem>
        )}
        {u.status === "invited" && (
          <MenuItem onSelect={() => onResend(u.id)}>
            <RotateCcw /> Resend invitation
          </MenuItem>
        )}
        <MenuSeparator />
        {u.status === "deactivated" ? (
          <MenuItem onSelect={() => onUpdate(u.id, { status: "active" })}>
            <UserCheck /> Reactivate
          </MenuItem>
        ) : (
          <MenuItem onSelect={() => onUpdate(u.id, { status: "deactivated" })} className="text-missing data-[highlighted]:text-missing [&_svg]:!text-missing">
            <UserX /> Deactivate
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

function InviteDialog({ open, onOpenChange, onInvited }: { open: boolean; onOpenChange: (o: boolean) => void; onInvited: (l: { url: string; emailed: boolean; email: string }) => void }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"trainer" | "org_admin">("trainer");
  const invite = useAction(inviteUserAction, {
    success: "Invitation created",
    toastErrors: false,
    onSuccess: (r) => {
      onOpenChange(false);
      onInvited({ url: r.inviteUrl, emailed: r.emailed, email });
      setName("");
      setEmail("");
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite user"
      description="They will set their own password with a secure one-time link."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={invite.pending} disabled={!name.trim() || !email.trim()} onClick={() => invite.run({ name, email, role })}>
            Send invitation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorPanel error={invite.error} />
        <Field label="Full name" htmlFor="inv-name" required>
          <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" htmlFor="inv-email" required error={invite.error?.fieldErrors?.email}>
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="inv-role">
          <NativeSelect id="inv-role" value={role} onChange={(e) => setRole(e.target.value as "trainer" | "org_admin")}>
            <option value="trainer">{ROLE_LABEL.trainer}</option>
            <option value="org_admin">{ROLE_LABEL.org_admin}</option>
          </NativeSelect>
        </Field>
      </div>
    </Dialog>
  );
}
