/** Resolve an external origin without trusting a caller-supplied Origin header.
 * Next's Node adapter may replace the incoming host with its bind hostname.
 * Only configured deployment aliases (or same-port loopback aliases locally)
 * may override that internal URL.
 */
export function getRequestOrigin(request: Request, env: Record<string, string | undefined> = process.env) {
  const requestUrl = new URL(request.url);
  const allowed = new Set<string>();
  for (const value of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (value) allowed.add(new URL(`https://${value}`).origin);
  }
  if (env.NEXT_PUBLIC_SITE_URL) allowed.add(new URL(env.NEXT_PUBLIC_SITE_URL).origin);
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const local = !env.VERCEL && (env.VERCEL_ENV || env.APP_ENV || "development") === "development" && loopback(requestUrl.hostname);
  const host = request.headers.get("host");
  if (host && !/[\s,/@\\?#]/.test(host)) {
    const candidate = new URL(`${local ? requestUrl.protocol : "https:"}//${host}`);
    if (allowed.has(candidate.origin) || (local && loopback(candidate.hostname) && candidate.port === requestUrl.port)) return candidate.origin;
  }
  if (allowed.has(requestUrl.origin) || local) return requestUrl.origin;
  // For a proxy's internal URL, use this deployment, not the production site.
  if (env.VERCEL_URL) return new URL(`https://${env.VERCEL_URL}`).origin;
  if (env.NEXT_PUBLIC_SITE_URL) return new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  throw new Error("The deployment's public origin is not configured.");
}
