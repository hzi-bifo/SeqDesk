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

/**
 * The policy for Compute's own pages. Next inlines its bootstrap scripts, so scripts stay 'self' plus inline; the
 * dev server also needs eval and its HMR websocket. Share links and API routes set their own, stricter policy.
 */
export function computePageCsp(dev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export const COMPUTE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

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
  // Playwright uses the loopback IP while Next may identify the dev host as
  // localhost. Declare that origin explicitly for current and future Next.js
  // dev-server cross-origin enforcement.
  allowedDevOrigins: ["127.0.0.1"],
  // Standalone output for distribution
  // Creates minimal deployment without node_modules
  output: "standalone",
  // Test sources have an explicit `typecheck:all` command. Keep the production
  // build focused on deployable code so test-only debt cannot block artifacts.
  typescript: {
    tsconfigPath: "tsconfig.production.json",
  },
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
      return [
        { source: "/:path*", headers: COMPUTE_SECURITY_HEADERS },
        {
          // Pages only: /api and /share answer with their own Content-Security-Policy (files, reports).
          source: "/((?!api/|share/|_next/).*)",
          headers: [
            { key: "Content-Security-Policy", value: computePageCsp() },
            { key: "X-Frame-Options", value: "SAMEORIGIN" },
          ],
        },
      ];
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
