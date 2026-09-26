import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

// Refreshes the auth session cookie on every request so Server Components
// always see a valid user, and turns away signed-out visitors early.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers ?? {}).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not add code between createServerClient and getClaims(): it is what
  // triggers the token refresh.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  // A fast first gate only. Pages still call requireMember()/requireRole(),
  // and the database still applies RLS, so this is not the security boundary.
  if (!signedIn && PROTECTED.some((p) => pathname.startsWith(p))) {
    return redirectWithCookies(request, response, "/login", { next: pathname });
  }
  if (signedIn && AUTH_PAGES.includes(pathname)) {
    return redirectWithCookies(request, response, "/dashboard");
  }

  return response;
}

const PROTECTED = ["/dashboard", "/assistant", "/leads", "/appointments", "/settings", "/no-workspace"];
const AUTH_PAGES = ["/login", "/signup"];

// Carry over any refreshed session cookies, or the user is signed out on redirect.
function redirectWithCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  params: Record<string, string> = {},
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = new URLSearchParams(params).toString();
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
