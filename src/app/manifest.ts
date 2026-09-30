import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gear Tractor",
    short_name: "Gear Tractor",
    description: "Equipment management for components, configurations, kits and consumables.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F6F5F2",
    theme_color: "#0B0B0F",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
