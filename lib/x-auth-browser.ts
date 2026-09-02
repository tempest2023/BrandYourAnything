import { getSupabaseBrowser } from "@/lib/supabase-browser";

type DevXAuthResponse = {
  error?: string;
  session?: {
    accessToken?: string;
    refreshToken?: string;
  };
};

export function isDevXAuthMockEnabled() {
  return process.env.NODE_ENV === "development"
    && process.env.NEXT_PUBLIC_X_AUTH_DEV_MOCK === "1";
}

export async function signInWithX(redirectTo: string) {
  const supabase = getSupabaseBrowser();
  if (!isDevXAuthMockEnabled()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "x",
      options: { redirectTo },
    });
    if (error) throw error;
    return;
  }

  const response = await fetch("/api/dev/x-auth", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json() as DevXAuthResponse;
  const accessToken = payload.session?.accessToken;
  const refreshToken = payload.session?.refreshToken;
  if (!response.ok || !accessToken || !refreshToken) {
    throw new Error(payload.error || "The local X sign-in mock did not return a session.");
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
}
