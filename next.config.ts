import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) ships wasm assets that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Receipt uploads travel through a server action as FormData. The client
  // downscales to ~1600px JPEG (~150-500KB); 4mb leaves headroom over the
  // 1MB default without opening the door to raw camera files.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // No page here is meant to be embedded; blocks clickjacking of the
          // join/accept and settings flows.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera=(self): the receipt flow may capture in-page one day; a
          // blanket camera=() would silently break it (audit §9 footgun).
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            // No "preload" until the custom domain is final.
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
