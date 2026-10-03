import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // The Content-Security-Policy is per request (it carries a nonce), so it
    // is set in src/proxy.ts; these are the same for every response.
    return [{ source: "/:path*", headers: staticSecurityHeaders(process.env.NODE_ENV === "production") }];
  },
};

export default nextConfig;
