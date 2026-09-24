import type { Metadata } from "next";
import { SignupForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create a workspace · TenantFlow" };

export default function SignupPage() {
  return <SignupForm />;
}
