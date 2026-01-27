"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";

export default function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();

  useEffect(() => {
    // Redirect to new order page with edit mode
    router.replace(`/dashboard/orders/new?edit=${resolvedParams.id}`);
  }, [router, resolvedParams.id]);

  return (
    <div className="p-8 flex items-center justify-center min-h-[400px]">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
