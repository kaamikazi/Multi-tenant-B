"use server";

import { redirect } from "next/navigation";
import { absoluteUrl, safeRelativePath } from "@/lib/security/urls";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  /** Set when sign-up succeeded but the email must be confirmed first. */
  checkEmail?: string;
  values?: Record<string, string>;
};

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();


export async function signUp(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = text(formData, "full_name");
  const companyName = text(formData, "company_name");
  const inviteToken = text(formData, "invite_token");
  const values = { email, full_name: fullName, company_name: companyName };

  if (!email || !password || !fullName) {
    return { error: "Please fill in every field.", values };
  }
  if (!inviteToken && !companyName) {
    return { error: "Give your workspace a name.", values };
  }
  if (password.length < 8) {
    return { error: "Use a password of at least 8 characters.", values };
  }
  // Mirrors the database limits (and bcrypt's 72-byte password limit) so
  // oversized input gets a clear message rather than a generic auth error.
  if (fullName.length > 100 || companyName.length > 100 || email.length > 254 || new TextEncoder().encode(password).length > 72) {
    return { error: "Names can be up to 100 characters, emails 254, passwords 72.", values };
  }

  const supabase = await createClient();

  // Check the invite up front: if the sign-up trigger rejects it, Supabase
  // only reports a generic "Database error saving new user".
  if (inviteToken) {
    const { data: invite } = await supabase
      .rpc("get_invitation", { p_token: inviteToken })
      .maybeSingle();
    if (invite?.status === "no_seats") {
      return { error: "This workspace has no free seats on its current plan. Ask the owner to upgrade or free a seat.", values };
    }
    if (!invite || invite.status !== "valid") {
      return { error: "This invitation is no longer valid. Ask for a new one.", values };
    }
    if (invite.email.toLowerCase() !== email) {
      return { error: `This invitation is for ${invite.email}.`, values };
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: absoluteUrl("/auth/confirm?next=/dashboard"),
      data: inviteToken
        ? { full_name: fullName, invite_token: inviteToken }
        : { full_name: fullName, company_name: companyName },
    },
  });

  if (error) {
    return { error: friendlyAuthError(error.message), values };
  }
  if (!data.session) {
    return { checkEmail: email };
  }
  redirect("/dashboard");
}

export async function signIn(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeRelativePath(text(formData, "next"));

  if (!email || !password) {
    return { error: "Enter your email and password.", values: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: friendlyAuthError(error.message), values: { email } };
  }
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** For a signed-in account with no workspace, e.g. someone removed and re-invited. */
export async function acceptInvitation(formData: FormData) {
  const token = text(formData, "token");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}

function friendlyAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first. Check your inbox for the link.";
  if (/already registered/i.test(message)) return "An account with this email already exists. Sign in instead.";
  if (/rate limit/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message;
}
