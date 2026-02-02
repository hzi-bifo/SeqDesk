"use client";

import { AlertCircle, X } from "lucide-react";

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onDismiss, className = "" }: ErrorBannerProps) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 ${className}`}
      style={{
        background: 'linear-gradient(90deg, #dc2626 0%, #b91c1c 100%)',
      }}
    >
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-3">
        <AlertCircle className="h-4 w-4 text-white/90 flex-shrink-0" />
        <span className="text-sm font-medium text-white">
          {message}
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="ml-4 p-1 rounded hover:bg-white/10 transition-colors text-white/80 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
