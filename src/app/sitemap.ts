import type { MetadataRoute } from "next";
import { BLOG_ENTRIES } from "@/lib/blog";
import { appBaseUrl } from "@/lib/invites";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBaseUrl();
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/en`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/blog`, changeFrequency: "weekly", priority: 0.6 },
    ...BLOG_ENTRIES.map((e) => ({
      url: `${base}/blog/${e.slug}`,
      lastModified: new Date(e.updated),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
