"use client";

import { useActionState } from "react";
import { createLead, updateLead } from "./actions";
import type { ActionResult } from "../settings/team/actions";
import { Alert, Button, Field } from "@/components/ui";
import { SOURCE_LABEL, STATUS_LABEL, type LeadSource, type LeadStatus } from "@/lib/leads";

export type LeadFormValues = {
  id?: string;
  name?: string;
  email?: string | null;
  company?: string | null;
  company_size?: number | null;
  budget_usd?: number | null;
  source?: LeadSource;
  status?: LeadStatus;
  owner_id?: string | null;
  notes?: string | null;
};

type Props = {
  lead?: LeadFormValues;
  /** Null hides the assignee picker (members can't reassign). */
  assignees: { id: string; name: string }[] | null;
};

const selectClass =
  "h-10 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function LeadForm({ lead, assignees }: Props) {
  const editing = Boolean(lead?.id);
  const [state, action, pending] = useActionState<ActionResult, FormData>(editing ? updateLead : createLead, {});

  return (
    <form action={action} className="grid gap-4 px-5 py-4">
      {lead?.id && <input type="hidden" name="id" value={lead.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required maxLength={120} defaultValue={lead?.name} />
        <Field label="Email" name="email" type="email" defaultValue={lead?.email ?? ""} />
        <Field label="Company" name="company" maxLength={120} defaultValue={lead?.company ?? ""} />
        <Field
          label="Company size"
          name="company_size"
          inputMode="numeric"
          placeholder="Employees"
          defaultValue={lead?.company_size ?? ""}
          hint="Up to 15 points: 200+ employees score highest."
        />
        <Field
          label="Budget (USD)"
          name="budget_usd"
          inputMode="numeric"
          placeholder="25000"
          defaultValue={lead?.budget_usd ?? ""}
          hint="Up to 25 points: $50,000+ scores highest."
        />
        <label className="grid min-w-0 content-start gap-1.5 text-sm">
          <span className="font-medium">Source</span>
          <select name="source" defaultValue={lead?.source ?? "other"} className={selectClass}>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className="text-xs text-muted">Up to 30 points: referrals and demo requests score highest.</span>
        </label>
        <label className="grid min-w-0 content-start gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={lead?.status ?? "new"} className={selectClass}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {assignees && (
          <label className="grid min-w-0 content-start gap-1.5 text-sm">
            <span className="font-medium">Assigned to</span>
            <select name="owner_id" defaultValue={lead?.owner_id ?? ""} className={selectClass}>
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="grid min-w-0 content-start gap-1.5 text-sm">
        <span className="font-medium">Notes</span>
        <textarea
          name="notes"
          rows={3}
          maxLength={4000}
          defaultValue={lead?.notes ?? ""}
          className="rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      {!editing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="engaged_now" defaultChecked className="size-4 accent-[var(--accent)]" />
          We&apos;ve just been in touch (counts toward recency)
        </label>
      )}

      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add lead"}
        </Button>
      </div>
    </form>
  );
}
