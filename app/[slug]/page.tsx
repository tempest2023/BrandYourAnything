import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuctionLandingPage } from "@/app/page";
import { LaptopAuction } from "@/app/laptop/[slug]/laptop-auction";
import { getAuctionSnapshot } from "@/lib/campaign-auction-repository";
import { auctionPath } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await getAuctionSnapshot(slug).catch(() => null);
  if (!snapshot) return { title: "Auction not found — Brand Anything" };
  return {
    title: `${snapshot.campaign.title} — Brand Anything`,
    description: snapshot.campaign.tagline,
    alternates: { canonical: auctionPath(snapshot.campaign.slug) },
    openGraph: {
      title: snapshot.campaign.title,
      description: snapshot.campaign.tagline,
      url: auctionPath(snapshot.campaign.slug),
      ...(snapshot.campaign.photoUrl ? { images: [snapshot.campaign.photoUrl] } : {}),
    },
  };
}

export default async function PublicLaptopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const snapshot = await getAuctionSnapshot(slug);
  if (!snapshot) notFound();
  return snapshot.campaign.assetType === "anything"
    ? <LaptopAuction initialSnapshot={snapshot} />
    : <AuctionLandingPage campaign={snapshot.campaign} initialSnapshot={snapshot} />;
}
