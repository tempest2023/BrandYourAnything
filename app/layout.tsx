import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { I18nProvider } from "@/app/i18n-provider";
import { LOCALE_COOKIE, localeTag, normalizeLocale } from "@/lib/i18n";
import { CURRENCY_COOKIE, normalizeCurrency } from "@/lib/money";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Brand Anything — Turn any object into a brand auction",
  description:
    "Upload a 3D model, publish a finite sponsorship auction, and let brands bid for placements on the object you carry, drive, sail, or fly.",
  openGraph: {
    title: "Brand Anything — Turn any object into a brand auction",
    description: "Create and share a live 3D sponsorship auction for almost any object.",
    images: [{ url: "/macbook.webp", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brand Anything — Turn any object into a brand auction",
    description: "Create and share a live 3D sponsorship auction for almost any object.",
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
