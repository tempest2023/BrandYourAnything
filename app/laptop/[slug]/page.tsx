import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getLaptopSnapshot } from "@/lib/laptop-repository";

import { LaptopAuction } from "./laptop-auction";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const snapshot = await getLaptopSnapshot(slug).catch(() => null);
  if (!snapshot) return { title: "Laptop not found — Brand Anything" };
  return {
    title: `${snapshot.campaign.title} — Brand Anything`,
    description: snapshot.campaign.tagline,
    openGraph: {
      title: snapshot.campaign.title,
      description: snapshot.campaign.tagline,
      ...(snapshot.campaign.photoUrl ? { images: [snapshot.campaign.photoUrl] } : {}),
    },
  };
}

export default async function LaptopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const snapshot = await getLaptopSnapshot(slug);
  if (!snapshot) notFound();
  return <LaptopAuction initialSnapshot={snapshot} />;
}
