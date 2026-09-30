import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { checkResetToken } from "@/server/auth/flows";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const valid = await checkResetToken(token);
  if (!valid) {
    return (
      <AuthCard title="Link expired" subtitle="This password reset link is invalid or has expired.">
        <Link href="/forgot-password" className="text-[14px] font-semibold text-brand hover:underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="Your other sessions will be signed out.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
