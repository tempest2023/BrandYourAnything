import type { NextConfig } from "next";

function supabaseImagePattern() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    || process.env.SUPABASE_URL?.trim();
  if (!configuredUrl) return null;

  const url = new URL(configuredUrl);
  return {
    protocol: url.protocol === "http:" ? "http" as const : "https" as const,
    hostname: url.hostname,
    port: url.port,
    pathname: "/storage/v1/object/sign/**",
  };
}

const signedStoragePattern = supabaseImagePattern();
const allowLocalSupabaseImages = signedStoragePattern
  ? ["127.0.0.1", "localhost", "::1"].includes(signedStoragePattern.hostname)
  : false;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: signedStoragePattern ? [signedStoragePattern] : [],
    dangerouslyAllowLocalIP: allowLocalSupabaseImages,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
