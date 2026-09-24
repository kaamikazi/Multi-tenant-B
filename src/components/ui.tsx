import type { ComponentProps, ReactNode } from "react";
import { ROLE_LABEL, type Role } from "@/lib/rbac";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  secondary: "border border-line bg-surface hover:bg-background",
  danger: "text-danger hover:bg-danger/10",
  ghost: "text-muted hover:text-foreground hover:bg-background",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="h-10 rounded-md border border-line bg-surface px-3 outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 read-only:bg-background read-only:text-muted"
        {...props}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-xl border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const ROLE_BADGE: Record<Role, string> = {
  owner: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  admin: "bg-accent/15 text-accent",
  member: "bg-zinc-500/15 text-muted",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", ROLE_BADGE[role])}>
      {ROLE_LABEL[role]}
    </span>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success"; children: ReactNode }) {
  const styles = {
    error: "border-danger/30 bg-danger/10 text-danger",
    info: "border-line bg-background text-muted",
    success: "border-success/30 bg-success/10 text-success",
  }[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", styles)}>
      {children}
    </p>
  );
}

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </header>
  );
}
