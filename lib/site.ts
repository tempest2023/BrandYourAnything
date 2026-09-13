export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://brand-anything.vercel.app"
).replace(/\/+$/, "");

export const SITE_HOST = new URL(SITE_URL).host;
export const DEFAULT_AUCTION_SLUG = "brand-my-mac";

export function auctionPath(slug: string) {
  return `/${slug}`;
}

export function auctionUrl(slug: string) {
  return `${SITE_URL}${auctionPath(slug)}`;
}

export const laptopUrl = auctionUrl;
export const publicLaptopUrl = auctionUrl;
