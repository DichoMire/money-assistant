import type { Metadata } from "next";
import { LandingPage } from "@/components/LandingPage";
import { appBaseUrl } from "@/lib/invites";

/** English twin of the Bulgarian landing at "/" (RFC 10 §3.1). */
export const metadata: Metadata = {
  title: "Money Assistant — split bills and track shared expenses",
  description:
    "Group expenses for trips, flatshares and nights out. Unlimited entries, free receipt scanning, no ads — runs in the browser, nothing to install.",
  alternates: {
    canonical: "/en",
    languages: { bg: "/", en: "/en", "x-default": "/" },
  },
  openGraph: {
    type: "website",
    siteName: "Money Assistant",
    locale: "en_US",
    alternateLocale: "bg_BG",
    title: "Money Assistant — split bills and track shared expenses",
    description: "Unlimited expenses. Free receipt scanning. No ads.",
    url: `${appBaseUrl()}/en`,
    images: [{ url: "/og/card-en.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function EnglishLandingPage() {
  return <LandingPage locale="en" />;
}
