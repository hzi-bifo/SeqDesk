import { Settings2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { PageContainer } from "@/components/layout/PageContainer";

export default function AdminDashboardPage() {
  return (
    <PageContainer className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
      <GlassCard className="max-w-lg p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Settings2 className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">Select an admin page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a page from the admin menu to manage users, facility settings,
          infrastructure, or integrations.
        </p>
      </GlassCard>
    </PageContainer>
  );
}
