import type { Metadata } from "next";

import { ManageAuctions } from "./manage-auctions";

export const metadata: Metadata = {
  title: "Manage your auctions — Brand Anything",
  description: "Manage auctions saved in this browser or attached to your X account.",
};

export default function ManagePage() {
  return <ManageAuctions />;
}
