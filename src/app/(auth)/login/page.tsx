import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/server/auth/session";
import { AuthCard } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const session = await getCurrentSession();
  if (session) redirect("/");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to manage your equipment.">
      <LoginForm next={next} />
    </AuthCard>
  );
}
