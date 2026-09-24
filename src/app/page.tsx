import Link from "next/link";
import { Logo } from "@/components/logo";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <Logo />
      <h1 className="text-4xl font-semibold tracking-tight">
        One platform. Every customer&apos;s data kept apart.
      </h1>
      <p className="text-lg text-muted">
        Multi-tenant AI SaaS platform: tenant isolation, RBAC, AI chatbot, lead scoring, Stripe subscriptions.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Create a workspace
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium hover:bg-background"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
