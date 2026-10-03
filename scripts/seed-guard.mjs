// Refuses to run the destructive demo seed unless it was explicitly allowed
// for this environment. Pure, so it is unit-tested in seed-guard.test.mjs.
//
// Required: ALLOW_DESTRUCTIVE_DEMO_SEED=true (e.g. in the gitignored .env.local
// of a demo project). Always refused when NODE_ENV=production.
export function seedRefusal(env) {
  if (env.NODE_ENV === "production") return "Refusing to seed: NODE_ENV is production.";
  if (env.ALLOW_DESTRUCTIVE_DEMO_SEED !== "true") {
    return [
      "Refusing to seed: this deletes and recreates the demo accounts and their workspaces.",
      "If this Supabase project is a demo/dev project, set ALLOW_DESTRUCTIVE_DEMO_SEED=true in .env.local and run again.",
    ].join("\n");
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local";
  }
  return null;
}
