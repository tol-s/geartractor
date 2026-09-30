import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot password" subtitle="Enter your email and we will send you a reset link.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
