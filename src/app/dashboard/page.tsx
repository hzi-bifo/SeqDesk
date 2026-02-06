import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { ChevronRight } from "lucide-react";

const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "text-muted-foreground", dot: "bg-muted-foreground" },
  SUBMITTED: { label: "Submitted", color: "text-blue-600", dot: "bg-blue-500" },
  COMPLETED: { label: "Completed", color: "text-emerald-600", dot: "bg-emerald-500" },
};

// Helper to check if department sharing is enabled
async function getDepartmentSharingInfo() {
  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    if (!settings?.extraSettings) return { enabled: false };
    const extra = JSON.parse(settings.extraSettings);
    return { enabled: extra.departmentSharing === true };
  } catch {
    return { enabled: false };
  }
}

// Helper to check sample metadata completion
function sampleHasMetadata(checklistData: string | null): boolean {
  if (!checklistData) return false;
  try {
    const data = JSON.parse(checklistData);
    return Object.values(data).some(v => v !== null && v !== "" && v !== undefined);
  } catch {
    return false;
  }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const isResearcher = session.user.role === "RESEARCHER";
  const isFacility = session.user.role === "FACILITY_ADMIN";

  // Check department sharing settings
  const { enabled: departmentSharing } = await getDepartmentSharingInfo();

  // Get user's department if researcher and sharing is enabled
  let userDepartment: { id: string; name: string } | null = null;
  let sharingMode: "personal" | "department" | "all" = isFacility ? "all" : "personal";

  if (isResearcher && departmentSharing) {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { department: { select: { id: true, name: true } } },
    });
    if (user?.department) {
      userDepartment = user.department;
      sharingMode = "department";
    }
  }

  // Build where clause based on sharing mode
  let orderWhereClause = {};
  let studyWhereClause = {};
  let sampleWhereClause = {};

  if (isFacility) {
    orderWhereClause = {};
    studyWhereClause = {};
    sampleWhereClause = {};
  } else if (sharingMode === "department" && userDepartment) {
    orderWhereClause = { user: { departmentId: userDepartment.id } };
    studyWhereClause = { user: { departmentId: userDepartment.id } };
    sampleWhereClause = { order: { user: { departmentId: userDepartment.id } } };
  } else {
    orderWhereClause = { userId: session.user.id };
    studyWhereClause = { userId: session.user.id };
    sampleWhereClause = { order: { userId: session.user.id } };
  }

  const [
    orderCount,
    studyCount,
    sampleCount,
    userCount,
    recentOrders,
    ordersByStatus,
    recentStudies,
    studiesByStatus,
  ] = await Promise.all([
    db.order.count({ where: orderWhereClause }),
    db.study.count({ where: studyWhereClause }),
    db.sample.count({ where: sampleWhereClause }),
    isFacility ? db.user.count() : Promise.resolve(0),
    db.order.findMany({
      where: orderWhereClause,
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { samples: true } },
      },
    }),
    db.order.groupBy({
      by: ["status"],
      where: orderWhereClause,
      _count: { status: true },
    }),
    db.study.findMany({
      where: studyWhereClause,
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        samples: { select: { id: true, checklistData: true } },
        _count: { select: { samples: true } },
      },
    }),
    db.study.groupBy({
      by: ["submitted"],
      where: studyWhereClause,
      _count: { submitted: true },
    }),
  ]);

  // Process order status counts
  const orderStatusCounts = ordersByStatus.reduce((acc, item) => {
    acc[item.status] = item._count.status;
    return acc;
  }, {} as Record<string, number>);

  const draftOrders = orderStatusCounts["DRAFT"] || 0;
  const activeOrders = orderStatusCounts["SUBMITTED"] || 0;
  const completedOrders = orderStatusCounts["COMPLETED"] || 0;

  // Process study status counts
  const studyStatusCounts = studiesByStatus.reduce((acc, item) => {
    acc[item.submitted ? "submitted" : "draft"] = item._count.submitted;
    return acc;
  }, {} as Record<string, number>);

  const draftStudies = studyStatusCounts["draft"] || 0;
  const submittedStudies = studyStatusCounts["submitted"] || 0;

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  // ============================================
  // RESEARCHER DASHBOARD - Simple and focused
  // ============================================
  if (isResearcher) {
    return (
      <PageContainer>
        {/* Welcome Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">
              Welcome back, {session.user.name?.split(" ")[0] || "Researcher"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {sharingMode === "department" && userDepartment
                ? `${userDepartment.name} workspace`
                : "Your sequencing workspace"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/orders/new">New Order</Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/studies/new">New Study</Link>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6">
          <div className="bg-card rounded-lg p-4 border border-border">
            <p className="text-2xl font-semibold">{sampleCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total Samples</p>
          </div>
          <div className="bg-card rounded-lg p-4 border border-border">
            <p className="text-2xl font-semibold">{activeOrders}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Active Orders</p>
          </div>
          <div className="bg-card rounded-lg p-4 border border-border">
            <p className="text-2xl font-semibold">{completedOrders}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Completed</p>
          </div>
        </div>

        {/* Orders and Studies side by side */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Orders Card */}
          <div className="bg-card rounded-lg overflow-hidden border border-border">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-medium text-sm">My Orders</h2>
              <Link href="/dashboard/orders" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all
              </Link>
            </div>

            {recentOrders.length === 0 ? (
              <div className="text-center py-10 px-5">
                <p className="text-sm text-muted-foreground mb-4">No orders yet</p>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/dashboard/orders/new">
                    Create Order
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentOrders.map((order) => {
                  const status = ORDER_STATUS_CONFIG[order.status] || ORDER_STATUS_CONFIG.DRAFT;
                  return (
                    <Link
                      key={order.id}
                      href={`/dashboard/orders/${order.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-secondary/50 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {order.name || order.orderNumber}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {order._count.samples} samples · {formatDate(order.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                        <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors ml-1" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Studies Card */}
          <div className="bg-card rounded-lg overflow-hidden border border-border">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-medium text-sm">My Studies</h2>
              <Link href="/dashboard/studies" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all
              </Link>
            </div>

            {recentStudies.length === 0 ? (
              <div className="text-center py-10 px-5">
                <p className="text-sm text-muted-foreground mb-4">No studies yet</p>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/dashboard/studies/new">
                    Create Study
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentStudies.map((study) => {
                  const samplesWithMetadata = study.samples.filter(s => sampleHasMetadata(s.checklistData)).length;
                  const totalSamples = study._count.samples;
                  const metadataComplete = totalSamples > 0 && samplesWithMetadata === totalSamples;

                  let statusLabel = "Draft";
                  let statusDot = "bg-muted-foreground";
                  let statusColor = "text-muted-foreground";

                  if (study.submitted) {
                    statusLabel = "Published";
                    statusDot = "bg-emerald-500";
                    statusColor = "text-emerald-600";
                  } else if (totalSamples > 0 && !metadataComplete) {
                    statusLabel = `${samplesWithMetadata}/${totalSamples}`;
                    statusDot = "bg-amber-500";
                    statusColor = "text-amber-600";
                  } else if (metadataComplete) {
                    statusLabel = "Ready";
                    statusDot = "bg-foreground";
                    statusColor = "text-foreground";
                  }

                  return (
                    <Link
                      key={study.id}
                      href={`/dashboard/studies/${study.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-secondary/50 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {study.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                          {study.checklistType?.replace(/-/g, " ") || "No type"} · {totalSamples} samples
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors ml-1" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </PageContainer>
    );
  }

  // ============================================
  // FACILITY ADMIN DASHBOARD - Administrative focus
  // ============================================
  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Facility Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Overview of all sequencing activity
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-2xl font-semibold">{orderCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total Orders</p>
          <p className="text-xs text-muted-foreground mt-2">
            <span className="text-amber-600">{activeOrders} active</span> · {draftOrders} draft
          </p>
        </div>

        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-2xl font-semibold">{studyCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total Studies</p>
          <p className="text-xs text-muted-foreground mt-2">
            <span className="text-emerald-600">{submittedStudies} published</span> · {draftStudies} draft
          </p>
        </div>

        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-2xl font-semibold">{sampleCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total Samples</p>
        </div>

        <div className="bg-card rounded-lg p-4 border border-border">
          <p className="text-2xl font-semibold">{userCount}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Researchers</p>
        </div>
      </div>

      {/* Order Status Breakdown */}
      <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-violet-500/10 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-sm">Order Pipeline</h2>
          <Link href="/dashboard/orders" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            View all
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-2 md:gap-2">
          {Object.entries(ORDER_STATUS_CONFIG).map(([status, config]) => {
            const count = orderStatusCounts[status] || 0;
            return (
              <div key={status} className="p-3 rounded-lg border text-center">
                <p className={`text-lg font-semibold ${config.color}`}>{count}</p>
                <p className="text-xs text-muted-foreground">{config.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <div className="bg-card rounded-lg overflow-hidden border border-border">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-medium text-sm">Recent Orders</h3>
            <Link href="/dashboard/orders" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <p className="text-sm">No orders yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentOrders.map((order) => {
                const status = ORDER_STATUS_CONFIG[order.status] || ORDER_STATUS_CONFIG.DRAFT;
                return (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-secondary/50 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                        {order.name || order.orderNumber}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {order.user.firstName} {order.user.lastName} · {order._count.samples} samples
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                      <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors ml-1" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Studies */}
        <div className="bg-card rounded-lg overflow-hidden border border-border">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-medium text-sm">Recent Studies</h3>
            <Link href="/dashboard/studies" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              View all
            </Link>
          </div>

          {recentStudies.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <p className="text-sm">No studies yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentStudies.map((study) => {
                const samplesWithMetadata = study.samples.filter(s => sampleHasMetadata(s.checklistData)).length;
                const totalSamples = study._count.samples;
                const metadataComplete = totalSamples > 0 && samplesWithMetadata === totalSamples;

                let statusLabel = "Draft";
                let statusDot = "bg-muted-foreground";
                let statusColor = "text-muted-foreground";

                if (study.submitted) {
                  statusLabel = "Published";
                  statusDot = "bg-emerald-500";
                  statusColor = "text-emerald-600";
                } else if (totalSamples > 0 && !metadataComplete) {
                  statusLabel = `${samplesWithMetadata}/${totalSamples}`;
                  statusDot = "bg-amber-500";
                  statusColor = "text-amber-600";
                } else if (metadataComplete) {
                  statusLabel = "Ready";
                  statusDot = "bg-foreground";
                  statusColor = "text-foreground";
                }

                return (
                  <Link
                    key={study.id}
                    href={`/dashboard/studies/${study.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-secondary/50 transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                        {study.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {study.user.firstName} {study.user.lastName} · {study.checklistType?.replace(/-/g, " ") || "No type"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                      <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors ml-1" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
