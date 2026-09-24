import type { Metadata } from "next";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in · TenantFlow" };

const NOTICES: Record<string, string> = {
  confirmed: "Email confirmed. Sign in to continue.",
  "link-invalid": "That link is invalid or has expired. Sign in or request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, notice } = await searchParams;
  return (
    <LoginForm
      next={typeof next === "string" ? next : undefined}
      notice={typeof notice === "string" ? NOTICES[notice] : undefined}
    />
  );
}
