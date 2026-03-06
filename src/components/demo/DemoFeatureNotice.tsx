"use client";

import Link from "next/link";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";

interface DemoFeatureNoticeProps {
  title: string;
  description: string;
}

export function DemoFeatureNotice({
  title,
  description,
}: DemoFeatureNoticeProps) {
  return (
    <PageContainer maxWidth="full">
      <div className="mx-auto my-16 max-w-2xl rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Ban className="h-5 w-5 text-foreground" />
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button asChild>
            <Link href="/orders">Back to Orders</Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
