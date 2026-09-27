import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Seaside Market",
    short_name: "Seaside",
    // The island sends newcomers to onboarding; existing fish land at home (not in a second onboarding).
    start_url: "/world",
    display: "standalone",
    background_color: "#fdf8f0",
    theme_color: "#1f6f8b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
