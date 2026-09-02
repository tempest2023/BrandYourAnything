import { AuctionLandingPage } from "@/app/auction-landing-page";
import { getDefaultLaptopSnapshot } from "@/lib/laptop-repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getDefaultLaptopSnapshot();
  if (!snapshot) {
    throw new Error("The default homepage auction has not been configured.");
  }

  return (
    <AuctionLandingPage
      campaign={snapshot.campaign}
      initialSnapshot={snapshot}
    />
  );
}
