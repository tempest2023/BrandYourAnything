import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Brand Anything — Put your brand on my laptop",
  description:
    "Publish your own 10-spot laptop sponsorship auction, accept live bids, and share a page built around the machine you carry.",
  openGraph: {
    title: "Brand Anything — Put your brand on my laptop",
    description: "Create and share a live 10-spot laptop sponsorship auction.",
    images: [{ url: "/macbook.webp", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brand Anything — Put your brand on my laptop",
    description: "Create and share a live 10-spot laptop sponsorship auction.",
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
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
