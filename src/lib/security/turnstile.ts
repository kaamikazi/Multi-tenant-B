// Optional Cloudflare Turnstile (a free CAPTCHA) for the public booking form.
//
// Off unless BOTH keys are set, so the demo works with no configuration:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  rendered in the browser (public)
//   TURNSTILE_SECRET_KEY            server-only, never sent to the browser
// If exactly one is set the deployment is misconfigured, and bookings are
// refused (fail closed) rather than silently running without the check.
//
// Pure module (fetch is injectable) so it is unit-tested in turnstile.test.ts.

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type CaptchaMode = "off" | "on" | "misconfigured";

export function captchaMode(env: Record<string, string | undefined> = process.env): CaptchaMode {
  const site = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const secret = Boolean(env.TURNSTILE_SECRET_KEY);
  if (site && secret) return "on";
  if (site || secret) return "misconfigured";
  return "off";
}

export type CaptchaResult = { ok: true } | { ok: false; reason: "missing" | "failed" | "unavailable" | "misconfigured" };

export async function verifyCaptcha(
  token: string | null,
  ip: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptchaResult> {
  const mode = captchaMode(env);
  if (mode === "off") return { ok: true };
  if (mode === "misconfigured") return { ok: false, reason: "misconfigured" };
  if (!token || token.length > 2048) return { ok: false, reason: "missing" };

  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    // Fail closed: if the check can't run, the booking doesn't either.
    return { ok: false, reason: "unavailable" };
  }
}
