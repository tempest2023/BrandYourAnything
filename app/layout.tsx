import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { I18nProvider } from "@/app/i18n-provider";
import { LOCALE_COOKIE, localeTag, normalizeLocale } from "@/lib/i18n";
import { CURRENCY_COOKIE, normalizeCurrency } from "@/lib/money";

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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const currency = normalizeCurrency(cookieStore.get(CURRENCY_COOKIE)?.value);

  return (
    <html lang={localeTag(locale)} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <I18nProvider initialLocale={locale} initialCurrency={currency}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
