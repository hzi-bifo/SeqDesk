"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "toast-modern",
          title: "toast-title",
          description: "toast-description",
          actionButton: "toast-action",
          cancelButton: "toast-cancel",
          error: "toast-error",
          success: "toast-success",
          warning: "toast-warning",
          info: "toast-info",
        },
      }}
      style={
        {
          "--normal-bg": "#ffffff",
          "--normal-text": "#171717",
          "--normal-border": "#e5e5e0",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
