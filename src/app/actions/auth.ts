"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/server/auth/session";
import { acceptInvitation, authenticate, requestPasswordReset, resetPassword } from "@/server/auth/flows";
import { toActionError, type ActionError } from "@/server/errors";

export type FormState = { error?: ActionError; done?: boolean; message?: string } | undefined;

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").max(200),
  password: z.string().min(1, "Enter your password").max(200),
  remember: z.string().optional(),
  next: z.string().optional(),
});

function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let target = "/dashboard";
  try {
    const v = loginSchema.parse(Object.fromEntries(formData));
    const result = await authenticate(v.email, v.password, await clientIp());
    await createSession(result.userId, v.remember === "on", null);
    target = safeNext(v.next) ?? (result.role === "super_admin" ? "/admin/organizations" : "/dashboard");
  } catch (err) {
    return { error: toActionError(err) };
  }
  redirect(target);
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const email = z.string().trim().email("Enter a valid email address").parse(formData.get("email"));
    await requestPasswordReset(email, await clientIp());
    return { done: true };
  } catch (err) {
    return { error: toActionError(err) };
  }
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const token = String(formData.get("token") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password !== confirm) {
      return { error: { title: "Passwords do not match", message: "Enter the same password twice.", code: "validation" } };
    }
    await resetPassword(token, password);
    return { done: true };
  } catch (err) {
    return { error: toActionError(err) };
  }
}

export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const token = String(formData.get("token") ?? "");
    const name = String(formData.get("name") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password !== confirm) {
      return { error: { title: "Passwords do not match", message: "Enter the same password twice.", code: "validation" } };
    }
    const res = await acceptInvitation(token, name, password);
    await createSession(res.userId, false, null);
  } catch (err) {
    return { error: toActionError(err) };
  }
  redirect("/dashboard?welcome=1");
}
