import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Footer } from "@/components/layout/Footer";
import { AdminDemoReadOnlyWrapper } from "@/components/demo/AdminDemoReadOnlyWrapper";
import { getCurrentVersion } from "@/lib/updater";
import { isPublicDemoEnabled } from "@/lib/demo/config";
import { isFacilityDemoSession } from "@/lib/demo/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect(isPublicDemoEnabled() ? "/demo" : "/login");
  }

  if (session.user.role !== "FACILITY_ADMIN") {
    redirect("/orders");
  }

  // Demo facility admins can view admin pages (read-only) but not modify anything

  const version = getCurrentVersion();

  return (
    <div className="min-h-screen bg-background">
      <DashboardShell user={session.user} version={version}>
        <AdminDemoReadOnlyWrapper isDemo={!!session.user.isDemo}>
          {children}
        </AdminDemoReadOnlyWrapper>
      </DashboardShell>
      <Footer />
    </div>
  );
}
