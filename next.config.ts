import type { NextConfig } from "next";

function getDemoFrameAncestors() {
  // Allow the demo to be embedded from both the primary seqdesk.org landing
  // page and the legacy seqdesk.com one (kept while .com is being retired), with
  // and without www. The browser blocks the iframe if the parent origin is not
  // listed, which surfaces as the "demo did not finish loading" timeout.
  const productionAncestors = [
    "'self'",
    "https://seqdesk.org",
    "https://www.seqdesk.org",
    "https://seqdesk.com",
    "https://www.seqdesk.com",
  ];

  if (process.env.NODE_ENV === "production") {
    return productionAncestors.join(" ");
  }

  return [
    ...productionAncestors,
    "http://localhost:*",
    "http://127.0.0.1:*",
  ].join(" ");
}

function getPublicAppSurface() {
  if (process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE === "workbench") {
    return "workbench";
  }

  if (process.env.SEQDESK_APP_SURFACE === "workbench") {
    return "workbench";
  }

  if (process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY === "1") {
    return "workbench";
  }

  return "lab";
}

const nextConfig: NextConfig = {
  // Standalone output for distribution
  // Creates minimal deployment without node_modules
  output: "standalone",
  env: {
    NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO:
      process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO ??
      process.env.SEQDESK_ENABLE_PUBLIC_DEMO ??
      "",
    NEXT_PUBLIC_SEQDESK_APP_SURFACE: getPublicAppSurface(),
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/orders",
        permanent: true,
      },
      {
        source: "/dashboard/:path*",
        destination: "/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    if (process.env.SEQDESK_ENABLE_PUBLIC_DEMO !== "true") {
      return [];
    }

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${getDemoFrameAncestors()}`,
          },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
