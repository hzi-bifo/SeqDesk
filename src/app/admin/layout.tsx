import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Footer } from "@/components/layout/Footer";
import { getCurrentVersion } from "@/lib/updater";
import { isPublicDemoEnabled } from "@/lib/demo/config";

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

  const version = getCurrentVersion();

  return (
    <div className="min-h-screen bg-background">
      <DashboardShell user={session.user} version={version}>
        {children}
      </DashboardShell>
      <Footer />
    </div>
  );
}
