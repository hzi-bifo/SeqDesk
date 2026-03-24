"use client";

import { Info } from "lucide-react";

interface AdminDemoReadOnlyWrapperProps {
  isDemo: boolean;
  children: React.ReactNode;
}

export function AdminDemoReadOnlyWrapper({
  isDemo,
  children,
}: AdminDemoReadOnlyWrapperProps) {
  if (!isDemo) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="mx-4 mt-4 mb-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3">
        <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-900">Demo mode</p>
          <p className="text-xs text-blue-700 mt-0.5">
            Admin pages are read-only in the public demo. In a real
            installation, you can manage users, configure infrastructure, and
            customize forms here.
          </p>
        </div>
      </div>
      <div className="pointer-events-none opacity-60 select-none">
        {children}
      </div>
    </>
  );
}
