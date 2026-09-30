import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-shell";
import { AcceptInviteForm } from "@/components/auth/forms";
import { getInvitation } from "@/server/auth/flows";
import { ROLE_LABEL } from "@/lib/domain";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const invite = await getInvitation(token);
  if (!invite || !invite.valid) {
    return (
      <AuthCard title="Invitation unavailable" subtitle="This invitation is invalid, expired or has already been used.">
        <p className="text-[14px] text-muted">Ask your organization administrator to send a new invitation.</p>
        <Link href="/login" className="mt-4 inline-block text-[14px] font-semibold text-brand hover:underline">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Join ${invite.orgName}`}
      subtitle={
        <>
          You have been invited as <strong className="text-ink">{ROLE_LABEL[invite.role]}</strong>. Set up your password to get started.
        </>
      }
    >
      <AcceptInviteForm token={token} name={invite.userName} email={invite.email} />
    </AuthCard>
  );
}
