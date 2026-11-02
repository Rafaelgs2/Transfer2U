import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Transfer2U",
    short_name: "Transfer2U",
    description: "Envie arquivos e mensagens entre celular e computador.",
    start_url: "/",
    display: "standalone",
    background_color: "#1f4bff",
    theme_color: "#1f4bff",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
