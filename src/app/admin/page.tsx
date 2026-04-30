import { db } from "@/lib/db";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Activity,
  Building2,
  Database,
  FileText,
  Settings2,
  Users,
  Workflow,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDashboardPage() {
  // Fetch stats
  const [departmentCount, userCount, orderCount] = await Promise.all([
    db.department.count(),
    db.user.count(),
    db.order.count(),
  ]);

  const researcherCount = await db.user.count({
    where: { role: "RESEARCHER" },
  });

  const stats = [
    {
      label: "Departments",
      value: departmentCount,
      icon: Building2,
      href: "/admin/departments",
    },
    {
      label: "Total Users",
      value: userCount,
      icon: Users,
      href: "/admin/users",
    },
    {
      label: "Researchers",
      value: researcherCount,
      icon: Users,
      href: "/admin/users?role=researcher",
    },
    {
      label: "Orders",
      value: orderCount,
      icon: FileText,
      href: "/orders",
    },
  ];

  const quickActions = [
    {
      href: "/admin/departments",
      title: "Departments",
      description: "Manage departments and their researcher lists",
      icon: Building2,
    },
    {
      href: "/admin/users",
      title: "Researchers",
      description: "Review registered researchers and admin accounts",
      icon: Users,
    },
    {
      href: "/admin/data-compute",
      title: "Infrastructure",
      description: "Check data storage, runtime, and setup JSON status",
      icon: Database,
    },
    {
      href: "/admin/settings/pipelines",
      title: "Pipelines",
      description: "Install, inspect, and test workflow packages",
      icon: Workflow,
    },
    {
      href: "/admin/settings",
      title: "Platform Info",
      description: "Open diagnostics and creator-facing checks",
      icon: Settings2,
    },
  ];

  return (
    <PageContainer>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          Manage your sequencing facility settings
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="block">
            <GlassCard className="p-6 transition-colors hover:bg-muted/30">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <stat.icon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </div>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Quick Actions
          </h2>
          <div className="space-y-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition-colors"
              >
                <action.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block font-medium">{action.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {action.description}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="text-center py-8 text-muted-foreground">
            <p>No recent activity</p>
          </div>
        </GlassCard>
      </div>
    </PageContainer>
  );
}
