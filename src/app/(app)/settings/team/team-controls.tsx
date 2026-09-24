"use client";

import { useActionState, useState } from "react";
import {
  changeRole,
  inviteMember,
  removeMember,
  transferOwnership,
  type ActionResult,
} from "./actions";
import { Alert, Button } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/rbac";

const selectClass =
  "h-9 rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

type Seats = { used: number; limit: number | null };

export function InviteForm({ roles, seats }: { roles: Role[]; seats: Seats | null }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(inviteMember, {});
  const full = seats?.limit != null && seats.used >= seats.limit;

  return (
    <form action={action} className="grid gap-3 px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="invite-email">Email</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <label className="sr-only" htmlFor="invite-role">Role</label>
        <select id="invite-role" name="role" defaultValue="member" className={selectClass}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <Button type="submit" disabled={pending || full}>{pending ? "Inviting…" : "Send invite"}</Button>
      </div>
      {seats?.limit != null && (
        <p className={`text-xs ${full ? "text-danger" : "text-muted"}`}>
          {seats.used} of {seats.limit} seats used on the Free plan
          {full ? ". Upgrade to Pro on the Billing page to invite more people." : "."}
        </p>
      )}
      {roles.length === 1 && (
        <p className="text-xs text-muted">Admins can invite members. Only the owner can invite admins.</p>
      )}
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
    </form>
  );
}

type MemberControlsProps = {
  userId: string;
  name: string;
  role: Role;
  canChangeRole: boolean;
  canRemove: boolean;
  canTransfer: boolean;
};

export function MemberControls({ userId, name, role, canChangeRole, canRemove, canTransfer }: MemberControlsProps) {
  const [removeState, removeAction, removePending] = useActionState<ActionResult, FormData>(removeMember, {});
  const [transferState, transferAction, transferPending] = useActionState<ActionResult, FormData>(transferOwnership, {});

  const error = removeState.error ?? transferState.error;

  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Remount when the saved role changes: React resets action forms to
            their default values after submit, so the default must be current. */}
        {canChangeRole && <RoleForm key={role} userId={userId} name={name} role={role} />}

        {canTransfer && (
          <form
            action={transferAction}
            onSubmit={(e) => {
              if (!confirm(`Make ${name} the owner? You will become an admin and can't undo this yourself.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" variant="ghost" disabled={transferPending}>Make owner</Button>
          </form>
        )}

        {canRemove && (
          <form
            action={removeAction}
            onSubmit={(e) => {
              if (!confirm(`Remove ${name} from the workspace?`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" variant="danger" disabled={removePending}>Remove</Button>
          </form>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function RoleForm({ userId, name, role }: { userId: string; name: string; role: Role }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(changeRole, {});
  const [selected, setSelected] = useState<Role>(role);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <label className="sr-only" htmlFor={`role-${userId}`}>Role for {name}</label>
      <select
        id={`role-${userId}`}
        name="role"
        defaultValue={role}
        onChange={(e) => setSelected(e.target.value as Role)}
        className={selectClass}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      {selected !== role && (
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      )}
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
