import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid size-7 place-items-center rounded-md bg-accent text-sm text-accent-foreground">
        T
      </span>
      TenantFlow
    </Link>
  );
}
