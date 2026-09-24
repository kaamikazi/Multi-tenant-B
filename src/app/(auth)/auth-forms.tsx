"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AuthFormState } from "./actions";
import { Alert, Button, Card, Field } from "@/components/ui";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signIn, {});

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back to your workspace.</p>

      <form action={action} className="mt-6 grid gap-4">
        {notice && <Alert tone="info">{notice}</Alert>}
        {state.error && <Alert>{state.error}</Alert>}
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create a workspace
        </Link>
      </p>
    </Card>
  );
}

type Invite = { token: string; email: string; tenantName: string; roleLabel: string };

export function SignupForm({ invite }: { invite?: Invite }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {});

  if (state.checkEmail) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-muted">
          We sent a confirmation link to <strong className="text-foreground">{state.checkEmail}</strong>.
          Open it to finish setting up your account.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">
        {invite ? `Join ${invite.tenantName}` : "Create your workspace"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {invite
          ? `You've been invited as ${invite.roleLabel.toLowerCase() === "admin" ? "an" : "a"} ${invite.roleLabel.toLowerCase()}.`
          : "You'll be the owner. Invite your team once you're in."}
      </p>

      <form action={action} className="mt-6 grid gap-4">
        {state.error && <Alert>{state.error}</Alert>}
        {invite && <input type="hidden" name="invite_token" value={invite.token} />}
        <Field
          label="Full name"
          name="full_name"
          autoComplete="name"
          required
          defaultValue={state.values?.full_name}
        />
        {!invite && (
          <Field
            label="Workspace name"
            name="company_name"
            placeholder="Acme Inc."
            autoComplete="organization"
            required
            defaultValue={state.values?.company_name}
          />
        )}
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          readOnly={Boolean(invite)}
          defaultValue={invite?.email ?? state.values?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters."
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating account…" : invite ? "Join workspace" : "Create workspace"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={invite ? `/login?next=/invite/${invite.token}` : "/login"}
          className="font-medium text-accent hover:underline"
        >
          Sign in
        </Link>
      </p>
    </Card>
  );
}
