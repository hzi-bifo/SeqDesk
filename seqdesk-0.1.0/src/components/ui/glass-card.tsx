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
          "bg-white/95 dark:bg-card/95",
          "backdrop-blur-sm",
          "border border-border/30",
          "p-6",
          "transition-all duration-200",
          variant === "elevated" && "shadow-lg shadow-primary/5 hover:shadow-xl hover:shadow-primary/10",
          variant === "default" && "shadow-md shadow-black/[0.03]",
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
