import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoBootstrapClient } from "@/components/demo/DemoBootstrapClient";
import { isPublicDemoEnabled } from "@/lib/demo/config";

export const metadata: Metadata = {
  title: "Embedded Researcher Demo",
  robots: {
    index: false,
    follow: false,
  },
};

export default function EmbeddedDemoPage() {
  if (!isPublicDemoEnabled()) {
    notFound();
  }

  return <DemoBootstrapClient embedded />;
}
