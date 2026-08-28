export type Currency = "EUR" | "USD";
export type SpotSize = "S" | "M" | "L";

export type Spot = {
  id: number;
  name: string;
  size: SpotSize;
  dimensions: string;
  holder: string;
  bid: number;
  minBid: number;
  bids: number;
  logo?: string;
  website?: string;
};

export type BidHistoryItem = {
  id: string;
  brand: string;
  spot: number;
  amount: number;
  time: string;
};

export type AuctionSnapshot = {
  spots: Spot[];
  history: BidHistoryItem[];
};

export type PlaceBidResult = {
  accepted: boolean;
  reason: "accepted" | "already_processed" | "bid_too_low" | "auction_closed" | "idempotency_conflict";
  currentBid: number;
  minimumNextBid: number;
  currentBidderName: string;
  bidCount: number;
  bidId: string | null;
};

export const EUR_TO_USD = 1.17;

export const FALLBACK_SPOTS: Spot[] = [
  { id: 2, name: "Marquee — above the logo", size: "L", dimensions: "9.5 × 5.5 cm", holder: "See.io", bid: 1715, minBid: 1725, bids: 3, logo: "/logos/see.png", website: "https://see.io" },
  { id: 1, name: "Top left banner", size: "L", dimensions: "9.5 × 5.5 cm", holder: "Postiz", bid: 1200, minBid: 1210, bids: 6, logo: "/logos/postiz.png", website: "https://postiz.io" },
  { id: 3, name: "Top right banner", size: "L", dimensions: "9.5 × 5.5 cm", holder: "PrivateAlps", bid: 1010, minBid: 1020, bids: 19, logo: "/logos/privatealps.png", website: "https://privatealps.net" },
  { id: 9, name: "Bottom center — under the logo", size: "M", dimensions: "9.5 × 4 cm", holder: "Felyn GO", bid: 710, minBid: 720, bids: 16, logo: "/logos/felyn.jpg" },
  { id: 8, name: "Bottom left strip", size: "M", dimensions: "9.5 × 4 cm", holder: "VedicAstrology.com", bid: 666, minBid: 676, bids: 13, logo: "/logos/vedic.png", website: "https://vedicastrology.com" },
  { id: 10, name: "Bottom right strip", size: "M", dimensions: "9.5 × 4 cm", holder: "Clipory", bid: 500, minBid: 510, bids: 14, logo: "/logos/clipory.svg", website: "https://clipory.app" },
  { id: 5, name: "Inner left — beside the logo", size: "S", dimensions: "4.5 × 4.5 cm", holder: "Surf Office", bid: 410, minBid: 420, bids: 12, logo: "/logos/surfoffice.png", website: "https://www.surfoffice.com" },
  { id: 6, name: "Inner right — beside the logo", size: "S", dimensions: "4.5 × 4.5 cm", holder: "emma.pet", bid: 377, minBid: 387, bids: 12, logo: "/logos/emma.png", website: "https://emma.pet" },
  { id: 4, name: "Middle left", size: "S", dimensions: "4.5 × 4.5 cm", holder: "Draftline Fantasy", bid: 375, minBid: 385, bids: 17, logo: "/logos/draftline.svg", website: "https://www.draftlinefantasy.com" },
  { id: 7, name: "Middle right", size: "S", dimensions: "4.5 × 4.5 cm", holder: "Moyai", bid: 370, minBid: 380, bids: 11, logo: "/logos/moyai.png", website: "https://moyai.ai" },
];

export const FALLBACK_HISTORY: BidHistoryItem[] = [
  { id: "fallback-1", brand: "See.io", spot: 2, amount: 1715, time: "18 minutes ago" },
  { id: "fallback-2", brand: "PrivateAlps", spot: 3, amount: 1010, time: "34 minutes ago" },
  { id: "fallback-3", brand: "Postiz", spot: 1, amount: 1200, time: "1 hour ago" },
  { id: "fallback-4", brand: "Felyn GO", spot: 9, amount: 710, time: "2 hours ago" },
  { id: "fallback-5", brand: "VedicAstrology.com", spot: 8, amount: 666, time: "3 hours ago" },
  { id: "fallback-6", brand: "Clipory", spot: 10, amount: 500, time: "4 hours ago" },
  { id: "fallback-7", brand: "Surf Office", spot: 5, amount: 410, time: "5 hours ago" },
  { id: "fallback-8", brand: "emma.pet", spot: 6, amount: 377, time: "6 hours ago" },
];
