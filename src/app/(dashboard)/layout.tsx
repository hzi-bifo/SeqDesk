import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Footer } from "@/components/layout/Footer";
import { getCurrentVersion } from "@/lib/updater";
import { isPublicDemoEnabled } from "@/lib/demo/config";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    if (!isPublicDemoEnabled()) {
      redirect("/login");
    }

    const requestHeaders = await headers();
    const fetchDest = requestHeaders.get("sec-fetch-dest");
    redirect(fetchDest === "iframe" ? "/demo/embed" : "/demo");
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
