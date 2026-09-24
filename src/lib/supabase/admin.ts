import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Bypasses RLS. Only for server code acting on verified external input,
// such as Stripe webhooks writing billing state. Never import from a page
// or action to read data on a user's behalf; use ./server for that.
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
