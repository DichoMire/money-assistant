import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) ships wasm assets that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
