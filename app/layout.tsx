import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Brand Anything — Open-source sponsorship auctions",
  description:
    "An open-source template for auctioning brand placements on the things you carry, build, and share.",
  openGraph: {
    title: "Brand Anything — Open-source sponsorship auctions",
    description: "Start with a blank canvas. Let real winning brands fill it.",
    images: [{ url: "/macbook.webp", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brand Anything — Open-source sponsorship auctions",
    description: "Start with a blank canvas. Let real winning brands fill it.",
    images: ["/macbook.webp"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbfbfd",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
