import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { absoluteUrl, safeRelativePath } from "@/lib/security/urls";
import { createClient } from "@/lib/supabase/server";

// Target of the link in Supabase's confirmation email. Exchanges the one-time
// token for a session, then continues into the app.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRelativePath(searchParams.get("next") ?? "/dashboard");

  const code = searchParams.get("code");

  const supabase = await createClient();
  // Supabase's default email template sends a PKCE ?code=; a customised
  // template can send ?token_hash=&type= instead. Accept either.
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("missing token") };

  if (!error) return NextResponse.redirect(absoluteUrl(next));

  return NextResponse.redirect(absoluteUrl("/login?notice=link-invalid"));
}
