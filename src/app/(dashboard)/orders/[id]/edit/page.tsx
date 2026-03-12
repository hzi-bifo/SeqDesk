"use client";

import { useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Redirect to new order page with edit mode, forwarding the step param if present
    const step = searchParams.get("step");
    const url = step
      ? `/orders/new?edit=${resolvedParams.id}&step=${step}`
      : `/orders/new?edit=${resolvedParams.id}`;
    router.replace(url);
  }, [router, resolvedParams.id, searchParams]);

  return (
    <div className="p-8 flex items-center justify-center min-h-[400px]">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
