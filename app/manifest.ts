import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Card Vault",
    short_name: "Cards",
    start_url: "/",
    display: "standalone",
    background_color: "#140c2e",
    theme_color: "#140c2e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
