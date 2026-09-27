import type { MetadataRoute } from "next";

/**
 * /manifest.webmanifest. Colours are the @theme tokens in globals.css:
 * surface for the splash, surface-raised (the header) for the status bar.
 *
 * The link to it is written by hand in the root layout, with
 * crossorigin="use-credentials": behind forward_auth, a manifest fetched
 * without cookies would get the Authentik login instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "One Room Gaming Clips",
    short_name: "clips",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#14161b",
    theme_color: "#1c1f26",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
