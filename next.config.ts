import type { NextConfig } from "next";

type RemoteImagePattern = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  pathname: string;
};

function supabaseImagePattern(value: string | undefined): RemoteImagePattern | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    return {
      protocol: url.protocol.slice(0, -1) as RemoteImagePattern["protocol"],
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/sign/**",
    };
  } catch {
    return null;
  }
}

function isLoopbackUrl(value: string | undefined) {
  if (!value) return false;

  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

const supabaseUrls = [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL];
const supabaseImagePatterns = Array.from(
  new Map(
    supabaseUrls
      .map(supabaseImagePattern)
      .filter((pattern): pattern is RemoteImagePattern => pattern !== null)
      .map((pattern) => [
        `${pattern.protocol}://${pattern.hostname}:${pattern.port}${pattern.pathname}`,
        pattern,
      ]),
  ).values(),
);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Signed Storage URLs use a changing token query parameter, so `search` must
    // remain unspecified while the host and signed-object path stay restricted.
    remotePatterns: supabaseImagePatterns,
    // The local Stripe E2E serves signed images from the local Supabase stack.
    // Hosted builds keep Next.js's private-network protection enabled.
    dangerouslyAllowLocalIP: supabaseUrls.some(isLoopbackUrl),
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
