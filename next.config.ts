import type { NextConfig } from "next";

function getDemoFrameAncestors() {
  const productionAncestors = [
    "'self'",
    "https://www.seqdesk.com",
    "https://seqdesk.com",
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

const nextConfig: NextConfig = {
  // Standalone output for distribution
  // Creates minimal deployment without node_modules
  output: "standalone",
  env: {
    NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO:
      process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO ??
      process.env.SEQDESK_ENABLE_PUBLIC_DEMO ??
      "",
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
