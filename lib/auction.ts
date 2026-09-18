export type { Currency } from "@/lib/money";
import type { SurfaceVector } from "@/lib/surface-spots";
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
  logoCover?: true;
  logo?: string;
  // Stable identity of the uploaded logo object. The signed `logo` URL is
  // re-minted on every render, so clients use this key to tell a re-signed URL
  // apart from a genuinely replaced logo.
  logoKey?: string;
  website?: string;
  surfacePosition?: SurfaceVector;
  surfaceNormal?: SurfaceVector;
};

export type BidHistoryItem = {
  id: string;
  brand: string;
  spot: number;
  amount: number;
  createdAt: string;
};

export type AuctionSnapshot = {
  spots: Spot[];
  history: BidHistoryItem[];
};

export const STARTER_SPOTS: Spot[] = [
  { id: 1, name: "Top left banner", size: "L", dimensions: "9.5 × 5.5 cm", holder: "", bid: 400, minBid: 400, bids: 0 },
  { id: 2, name: "Marquee — above the logo", size: "L", dimensions: "9.5 × 5.5 cm", holder: "", bid: 400, minBid: 400, bids: 0 },
  { id: 3, name: "Top right banner", size: "L", dimensions: "9.5 × 5.5 cm", holder: "", bid: 400, minBid: 400, bids: 0 },
  { id: 4, name: "Middle left", size: "S", dimensions: "4.5 × 4.5 cm", holder: "", bid: 125, minBid: 125, bids: 0 },
  { id: 5, name: "Inner left — beside the logo", size: "S", dimensions: "4.5 × 4.5 cm", holder: "", bid: 125, minBid: 125, bids: 0 },
  { id: 6, name: "Inner right — beside the logo", size: "S", dimensions: "4.5 × 4.5 cm", holder: "", bid: 125, minBid: 125, bids: 0 },
  { id: 7, name: "Middle right", size: "S", dimensions: "4.5 × 4.5 cm", holder: "", bid: 125, minBid: 125, bids: 0 },
  { id: 8, name: "Bottom left strip", size: "M", dimensions: "9.5 × 4 cm", holder: "", bid: 200, minBid: 200, bids: 0 },
  { id: 9, name: "Bottom center — under the logo", size: "M", dimensions: "9.5 × 4 cm", holder: "", bid: 200, minBid: 200, bids: 0 },
  { id: 10, name: "Bottom right strip", size: "M", dimensions: "9.5 × 4 cm", holder: "", bid: 200, minBid: 200, bids: 0 },
];

export const STARTER_HISTORY: BidHistoryItem[] = [];
