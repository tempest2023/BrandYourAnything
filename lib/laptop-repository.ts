import "server-only";

// Stripe's historical payment flow still imports this name. The application
// now serves the auction model, so keep the compatibility export at this
// boundary instead of reintroducing a second laptops repository.
export { getAuctionSnapshot as getLaptopSnapshot } from "@/lib/campaign-auction-repository";
