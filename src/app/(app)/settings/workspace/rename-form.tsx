"use client";

import { useActionState } from "react";
import { renameWorkspace } from "./actions";
import type { ActionResult } from "../team/actions";
import { Alert, Button, Field } from "@/components/ui";

export function RenameForm({ name, editable }: { name: string; editable: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(renameWorkspace, {});

  return (
    <form action={action} className="grid gap-3 px-5 py-4">
      <Field
        label="Workspace name"
        name="name"
        defaultValue={name}
        readOnly={!editable}
        maxLength={100}
        required
        hint={editable ? undefined : "Only the owner can rename the workspace."}
      />
      {editable && (
        <div>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      )}
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
    </form>
  );
}
