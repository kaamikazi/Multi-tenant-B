import type { Database } from "@/lib/supabase/database.types";

export type Role = Database["public"]["Enums"]["tenant_role"];

// The UI's copy of the rules in supabase/migrations/*_auth_and_rbac.sql.
// These only decide what to *show*. The database enforces the same rules
// with RLS and checked RPCs, so a hidden button is never the only defence.

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: "Full control, including billing, roles and ownership transfer.",
  admin: "Invites and removes members, and can view billing.",
  member: "Works with the workspace's data. Cannot manage the team.",
};

type Permission =
  | "team:view_invitations"
  | "billing:view"
  | "workspace:rename"
  | "roles:change"
  | "ownership:transfer";

const PERMISSIONS: Record<Permission, readonly Role[]> = {
  "team:view_invitations": ["owner", "admin"],
  "billing:view": ["owner", "admin"],
  "workspace:rename": ["owner"],
  "roles:change": ["owner"],
  "ownership:transfer": ["owner"],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[permission].includes(role);
}

/** Roles `actor` may hand out in an invitation. */
export function invitableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["member", "admin"];
  if (actor === "admin") return ["member"];
  return [];
}

/** Whether `actor` may remove a teammate who has `target` role. */
export function canRemove(actor: Role, target: Role): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target === "member";
}

/** Whether `actor` may revoke a pending invitation for `invitedRole`. */
export function canRevokeInvite(actor: Role, invitedRole: Role): boolean {
  return canRemove(actor, invitedRole);
}

/** Every permission a role has, for the dashboard's "what you can do" panel. */
export function describePermissions(role: Role) {
  return [
    { label: "Invite members", allowed: invitableRoles(role).includes("member") },
    { label: "Invite admins", allowed: invitableRoles(role).includes("admin") },
    { label: "Remove members", allowed: canRemove(role, "member") },
    { label: "Remove admins", allowed: canRemove(role, "admin") },
    { label: "Change roles", allowed: can(role, "roles:change") },
    { label: "View billing", allowed: can(role, "billing:view") },
    { label: "Rename workspace", allowed: can(role, "workspace:rename") },
    { label: "Transfer ownership", allowed: can(role, "ownership:transfer") },
  ];
}
