export const PRODUCTION_SITE_URL = "https://brand-anything.vercel.app";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION_SITE_URL
).replace(/\/+$/, "");

export const SITE_HOST = new URL(SITE_URL).host;

export function laptopPath(slug: string) {
  return `/${slug}`;
}

export function laptopUrl(slug: string) {
  return `${SITE_URL}${laptopPath(slug)}`;
}

export function publicLaptopUrl(slug: string) {
  const configuredUrl = new URL(SITE_URL);
  const isLocal = configuredUrl.hostname === "localhost"
    || configuredUrl.hostname === "127.0.0.1"
    || configuredUrl.hostname === "[::1]";
  const baseUrl = isLocal ? PRODUCTION_SITE_URL : SITE_URL;
  return `${baseUrl}${laptopPath(slug)}`;
}
