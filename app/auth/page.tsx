import type { Metadata } from "next";

import type { AuthMode } from "./auth-form";
import { AuthPage } from "./auth-page";

export const metadata: Metadata = {
  title: "Sign in or create an account — Brand Anything",
  description: "Use email and password, X, or GitHub to access Brand Anything.",
};

type AuthRouteProps = {
  searchParams: Promise<{
    mode?: string | string[];
    confirmed?: string | string[];
  }>;
};

export default async function AuthRoute({ searchParams }: AuthRouteProps) {
  const parameters = await searchParams;
  const mode: AuthMode = parameters.mode === "sign-in" ? "sign-in" : "sign-up";
  const confirmed = parameters.confirmed === "1";

  return <AuthPage initialMode={mode} emailConfirmed={confirmed} />;
}
