import * as React from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "subtle";
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, children, variant = "default", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl",
          "bg-card dark:bg-card",
          "border border-border",
          "p-6",
          "transition-all duration-200",
          variant === "elevated" && "shadow-lg shadow-neutral-900/5 hover:shadow-xl hover:shadow-neutral-900/8",
          variant === "default" && "shadow-md shadow-neutral-900/[0.03]",
          variant === "subtle" && "shadow-sm",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
GlassCard.displayName = "GlassCard";

export { GlassCard };
