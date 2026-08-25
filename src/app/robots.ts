import type { MetadataRoute } from "next";
import { appBaseUrl } from "@/lib/invites";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/en", "/blog"],
      // /groups also covers the scan pages; /join tokens are bearer URLs.
      disallow: ["/groups/", "/join/", "/api/", "/login", "/settings"],
    },
    sitemap: `${appBaseUrl()}/sitemap.xml`,
  };
}
