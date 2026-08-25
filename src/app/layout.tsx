import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleProvider } from "@/components/LocaleProvider";
import { getLocale, getT } from "@/lib/i18n-server";
import { appBaseUrl } from "@/lib/invites";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

// Edge-to-edge phones draw the page behind the status bar; claim that area
// (viewport-fit=cover) so the white header can pad itself into it, and keep
// the browser-painted chrome white to match.
export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    metadataBase: new URL(appBaseUrl()),
    title: {
      default: t("app.title"),
      template: "%s · Money Assistant",
    },
    description: t("app.tagline"),
    icons: {
      apple: "/apple-touch-icon.png",
    },
    appleWebApp: {
      capable: true,
      title: "Money Assistant",
      statusBarStyle: "default",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        {/* Cookieless (request-hash, discarded after 24h) — keeps the
            no-consent-banner status. No custom events carry personal data. */}
        <Analytics />
      </body>
    </html>
  );
}
