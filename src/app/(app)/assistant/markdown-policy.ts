import { createElement } from "react";
import type { Components } from "react-markdown";
import { safeRelativePath } from "../../../lib/security/urls.ts";

// The security-relevant rendering rules for assistant Markdown, kept in a
// plain .ts module so they are unit-tested (markdown-policy.test.ts).
//
// Model output is untrusted: a prompt injection hidden in workspace data could
// make the model emit Markdown that leaks data to another server. So:
//   - images never render (the browser would fetch them automatically);
//     only the alt text is shown;
//   - links stay clickable only when they point inside this app. External,
//     mailto: and javascript: links render as plain text.
// Raw HTML is disabled separately with react-markdown's `skipHtml`.

// Any fixed origin works: it's only used to decide whether an href is a
// same-app relative path.
const CHECK_ORIGIN = "https://tenantflow.invalid";

export function internalHref(href: string | undefined): string | null {
  if (!href) return null;
  return safeRelativePath(href, "", CHECK_ORIGIN) === href ? href : null;
}

export const policyComponents: Pick<Components, "img" | "a"> = {
  img: ({ alt }) => (alt ? createElement("span", { className: "text-muted" }, `[${alt}]`) : null),
  a: ({ href, children }) => {
    const internal = internalHref(href);
    return internal
      ? createElement("a", { href: internal, className: "text-accent underline" }, children)
      : createElement("span", null, children);
  },
};
