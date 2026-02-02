import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[100px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-foreground/20 focus-visible:ring-2 focus-visible:ring-foreground/5",
          "dark:bg-card dark:border-border",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
