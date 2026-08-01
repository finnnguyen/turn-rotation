import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Turn Rotation",
    short_name: "Rotation",
    description:
      "A transparent employee turn-rotation system for nail and hair salons.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#163c35",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/maskable-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
