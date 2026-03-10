import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoBootstrapClient } from "@/components/demo/DemoBootstrapClient";
import { isPublicDemoEnabled } from "@/lib/demo/config";

export const metadata: Metadata = {
  title: "Researcher Demo",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DemoPage() {
  if (!isPublicDemoEnabled()) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <DemoBootstrapClient demoExperience="researcher" />
    </Suspense>
  );
}
