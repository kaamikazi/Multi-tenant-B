import Link from "next/link";

// Public pages: no sign-in, no app chrome.
export default function BookLayout({ children }: LayoutProps<"/book">) {
  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-16">{children}</main>
      <footer className="px-4 pb-8 text-center text-xs text-muted">
        Scheduling by{" "}
        <Link href="/" className="font-medium text-foreground hover:text-accent">TenantFlow</Link>
      </footer>
    </div>
  );
}
