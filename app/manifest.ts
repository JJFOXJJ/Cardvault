import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Card Vault",
    short_name: "Cards",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#0f1115",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
