import { Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { cn } from "@/lib/utils";

/**
 * Standard route-level loading state.
 *
 * Replaces the ad-hoc mix of plain "Loading…" text and one-off spinner sizes/
 * colors. Use for full-page loading (waiting on the page's primary data); for
 * small inline spinners keep a local <Loader2 className="animate-spin" />.
 */
export function PageLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <PageContainer className={cn("flex items-center justify-center min-h-[400px]", className)}>
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">{label}</p>
      </div>
    </PageContainer>
  );
}
