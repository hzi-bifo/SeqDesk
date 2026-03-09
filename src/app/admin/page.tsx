import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/glass-card";
import { PageContainer } from "@/components/layout/PageContainer";
import { Building2, Users, FileText, Activity } from "lucide-react";

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
      href: "/admin/orders",
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
          <GlassCard key={stat.label} className="p-6">
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
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Quick Actions
          </h2>
          <div className="space-y-2">
            <a
              href="/admin/departments"
              className="block p-3 rounded-lg hover:bg-muted transition-colors"
            >
              <p className="font-medium">Manage Departments</p>
              <p className="text-sm text-muted-foreground">
                Add, edit, or remove research departments
              </p>
            </a>
            <a
              href="/admin/users"
              className="block p-3 rounded-lg hover:bg-muted transition-colors"
            >
              <p className="font-medium">View Users</p>
              <p className="text-sm text-muted-foreground">
                See all registered researchers and admins
              </p>
            </a>
            <a
              href="/admin/settings"
              className="block p-3 rounded-lg hover:bg-muted transition-colors"
            >
              <p className="font-medium">Site Settings</p>
              <p className="text-sm text-muted-foreground">
                Configure branding and ENA credentials
              </p>
            </a>
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
