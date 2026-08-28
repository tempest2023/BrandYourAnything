import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Brand My Mac — Let your brand travel",
  description:
    "Put your brand on a founder's MacBook. Pick a sticker spot, place a bid, and let your logo travel.",
  openGraph: {
    title: "Brand My Mac — Let your brand travel",
    description: "Your brand, on my Mac.",
    images: [{ url: "/macbook.webp", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brand My Mac — Let your brand travel",
    description: "Your brand, on my Mac.",
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
