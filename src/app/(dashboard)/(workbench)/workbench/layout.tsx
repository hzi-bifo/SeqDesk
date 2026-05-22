import { notFound } from "next/navigation";

import { isWorkbenchAppSurface } from "@/lib/app-surface";

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  if (!isWorkbenchAppSurface()) {
    notFound();
  }

  return children;
}
