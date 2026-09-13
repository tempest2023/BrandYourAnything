import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LOCALE_COOKIE, normalizeLocale, translate } from "@/lib/i18n";

import type { AuthMode } from "./auth-form";
import { AuthPage } from "./auth-page";

export async function generateMetadata(): Promise<Metadata> {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    title: translate(locale, "auth.metaTitle"),
    description: translate(locale, "auth.metaDescription"),
  };
}

type AuthRouteProps = {
  searchParams: Promise<{
    mode?: string | string[];
    confirmed?: string | string[];
    next?: string | string[];
  }>;
};

export default async function AuthRoute({ searchParams }: AuthRouteProps) {
  const parameters = await searchParams;
  const mode: AuthMode = parameters.mode === "sign-in" ? "sign-in" : "sign-up";
  const confirmed = parameters.confirmed === "1";

  // Only the management destination is supported; never redirect to arbitrary input.
  const nextPath = parameters.next === "/manage" ? "/manage" : null;
  return <AuthPage initialMode={mode} emailConfirmed={confirmed} nextPath={nextPath} />;
}
