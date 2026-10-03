import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header. Both
 * sides are hashed first so their lengths always match. A missing or short
 * (< 32 chars) configured secret disables the endpoint entirely.
 */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}
