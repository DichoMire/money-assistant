import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and auto-linked by Next. Makes the app
// installable ("add to home screen") on Android/Chromium; iOS uses the
// apple-touch-icon + appleWebApp metadata in layout.tsx instead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Money Assistant",
    short_name: "Money Assistant",
    description: "Track group expenses, split bills, and simplify who pays whom.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
