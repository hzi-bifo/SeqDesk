import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: React.ReactNode;
  /**
   * Maximum width variant:
   * - "full": No max-width, uses full container width (default for list pages)
   * - "narrow": max-w-2xl - for forms and settings
   * - "medium": max-w-4xl - for detail pages with moderate content
   * - "wide": max-w-6xl - for content-heavy pages
   */
  maxWidth?: "full" | "narrow" | "medium" | "wide";
  className?: string;
}

/**
 * PageContainer provides consistent padding and max-width for all dashboard pages.
 *
 * Standard padding: px-8 py-8 (32px)
 *
 * Usage:
 * ```tsx
 * // Full width (default) - for list pages
 * <PageContainer>...</PageContainer>
 *
 * // Narrow width - for forms/settings
 * <PageContainer maxWidth="narrow">...</PageContainer>
 *
 * // Medium width - for detail pages
 * <PageContainer maxWidth="medium">...</PageContainer>
 * ```
 */
export function PageContainer({
  children,
  maxWidth = "full",
  className,
}: PageContainerProps) {
  const maxWidthClass = {
    full: "",
    narrow: "max-w-2xl mx-auto",
    medium: "max-w-4xl mx-auto",
    wide: "max-w-6xl mx-auto",
  }[maxWidth];

  return (
    <div className={cn("p-8", maxWidthClass, className)}>
      {children}
    </div>
  );
}
