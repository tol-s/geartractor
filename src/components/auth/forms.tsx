"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { acceptInviteAction, forgotPasswordAction, loginAction, resetPasswordAction, type FormState } from "@/app/actions/auth";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/input";
import { Checkbox } from "../ui/controls";
import { ErrorPanel } from "../shared/error-panel";

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-12" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-ink/5"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, undefined);
  const [remember, setRemember] = React.useState(true);
  return (
    <form action={action} className="space-y-4" noValidate>
      <ErrorPanel error={state?.error ?? null} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus placeholder="you@company.com" />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput id="password" name="password" autoComplete="current-password" required placeholder="Your password" />
      </Field>
      <div className="flex items-center justify-between">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px] font-medium text-ink-2">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} aria-label="Remember me" />
          Remember me
          {remember && <input type="hidden" name="remember" value="on" />}
        </label>
        <Link href="/forgot-password" className="text-[14px] font-semibold text-brand hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" variant="brand" size="lg" className="w-full" loading={pending}>
        {pending ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, undefined);
  if (state?.done) {
    return (
      <div className="flex flex-col items-center py-2 text-center">
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-available text-white">
          <MailCheck className="size-7" />
        </span>
        <p className="text-[15px] font-semibold">Check your inbox</p>
        <p className="mt-1 text-[14px] text-muted">If an account exists for that email, we have sent a link to reset your password. It expires in 1 hour.</p>
        <Link href="/login" className="mt-6 text-[14px] font-semibold text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <ErrorPanel error={state?.error ?? null} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="you@company.com" />
      </Field>
      <Button type="submit" variant="brand" size="lg" className="w-full" loading={pending}>
        Send reset link
      </Button>
      <p className="text-center text-[14px] text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, undefined);
  if (state?.done) {
    return (
      <div className="text-center">
        <p className="text-[15px] font-semibold">Password updated</p>
        <p className="mt-1 text-[14px] text-muted">You can now sign in with your new password.</p>
        <Button asChild variant="brand" size="lg" className="mt-6 w-full">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <ErrorPanel error={state?.error ?? null} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" hint="At least 10 characters, including a letter and a number.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" variant="brand" size="lg" className="w-full" loading={pending}>
        Update password
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token, name, email }: { token: string; name: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptInviteAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <ErrorPanel error={state?.error ?? null} />
      <input type="hidden" name="token" value={token} />
      <Field label="Email">
        <Input value={email} readOnly disabled />
      </Field>
      <Field label="Full name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} autoComplete="name" required />
      </Field>
      <Field label="Create password" htmlFor="password" hint="At least 10 characters, including a letter and a number.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" variant="brand" size="lg" className="w-full" loading={pending}>
        Set password &amp; continue
      </Button>
    </form>
  );
}
