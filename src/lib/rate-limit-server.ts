import "server-only";

import { headers } from "next/headers";
import { clientIp, createRateLimiter, type LimitRule } from "@/lib/rate-limit";

// One limiter per server process, shared by every public endpoint.
const limiter = createRateLimiter();

export async function requestIp() {
  return clientIp(await headers());
}

/** True when this request is within `rule` for `key`. */
export async function allow(key: string, rule: LimitRule) {
  return (await limiter.hit(key, rule)).ok;
}
