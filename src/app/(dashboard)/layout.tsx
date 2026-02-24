import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Footer } from "@/components/layout/Footer";
import { getCurrentVersion } from "@/lib/updater";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
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
