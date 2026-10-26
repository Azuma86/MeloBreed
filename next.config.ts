import type { NextConfig } from "next";

const posthogRegion =
  process.env.NEXT_PUBLIC_POSTHOG_REGION === "eu" ? "eu" : "us";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Relay analytics through this origin so ad blockers drop fewer events (PostHog's setup).
  // The end-to-end test build (playwright.config.ts) gets no relay, so its events never leave.
  async rewrites() {
    if (process.env.MELOBREED_E2E === "1") return [];
    return [
      {
        source: "/ingest/static/:path*",
        destination: `https://${posthogRegion}-assets.i.posthog.com/static/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `https://${posthogRegion}.i.posthog.com/:path*`,
      },
    ];
  },
  // PostHog's API paths end in slashes; redirecting them would break the relay.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
