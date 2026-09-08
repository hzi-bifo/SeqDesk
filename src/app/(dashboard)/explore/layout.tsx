import { notFound } from "next/navigation";
import { isExploreModuleEnabled } from "@/lib/explore/module";

export default async function ExploreLayout({ children }: { children: React.ReactNode }) {
  if (!(await isExploreModuleEnabled())) {
    notFound();
  }
  return children;
}
