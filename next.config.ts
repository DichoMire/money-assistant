import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) ships wasm assets that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
