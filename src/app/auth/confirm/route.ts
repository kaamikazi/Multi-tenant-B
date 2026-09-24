import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Target of the link in Supabase's confirmation email. Exchanges the one-time
// token for a session, then continues into the app.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const code = searchParams.get("code");

  const supabase = await createClient();
  // Supabase's default email template sends a PKCE ?code=; a customised
  // template can send ?token_hash=&type= instead. Accept either.
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("missing token") };

  if (!error) return NextResponse.redirect(new URL(next, request.url));

  return NextResponse.redirect(new URL("/login?notice=link-invalid", request.url));
}
