import type { MetadataRoute } from "next";

/**
 * SeqDesk is a login-gated application, not public content — nothing here
 * belongs in a search index, and the public site (seqdesk.org) carries the SEO.
 *
 * The root layout already sends `noindex` for the public demo, but a meta tag
 * only takes effect *after* the crawler has loaded the page: on the hosted demo
 * that means a JavaScript-executing crawler bootstraps a fully seeded throwaway
 * workspace on every visit, and each of those wakes the database for at least
 * the five-minute scale-to-zero window. Disallowing the fetch is what actually
 * saves the compute.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
