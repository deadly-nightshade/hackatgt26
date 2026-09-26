import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Seaside Market",
    short_name: "Seaside",
    start_url: "/onboarding",
    display: "standalone",
    background_color: "#fdf8f0",
    theme_color: "#1f6f8b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
