export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">TenantFlow</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Multi-tenant AI SaaS platform: tenant isolation, RBAC, AI chatbot, lead
        scoring, Stripe subscriptions.
      </p>
    </main>
  );
}
