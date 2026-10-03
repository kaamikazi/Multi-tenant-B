import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TenantFlow",
  description: "Multi-tenant AI SaaS platform: tenant isolation, RBAC, AI chatbot, lead scoring, Stripe subscriptions.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so Next.js can put this request's CSP
  // nonce on its scripts (see src/proxy.ts). A prerendered page would carry
  // no nonce and its scripts would be blocked.
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
