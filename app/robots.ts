import type { MetadataRoute } from "next";

// Only the home page belongs in search engines: rooms are private links.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/r/", "/api/"] } };
}
