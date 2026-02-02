import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Plus,
  ArrowRight,
  ChevronRight,
} from "lucide-react";

const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; bgColor: string }> = {
  DRAFT: { label: "Draft", color: "text-muted-foreground", dot: "bg-muted-foreground", bgColor: "bg-secondary" },
  READY_FOR_SEQUENCING: { label: "Ready", color: "text-foreground", dot: "bg-foreground", bgColor: "bg-secondary" },
  SEQUENCING_IN_PROGRESS: { label: "Sequencing", color: "text-amber-600", dot: "bg-amber-500", bgColor: "bg-secondary" },
  SEQUENCING_COMPLETED: { label: "Seq. Done", color: "text-foreground", dot: "bg-foreground", bgColor: "bg-secondary" },
  DATA_PROCESSING: { label: "Processing", color: "text-amber-600", dot: "bg-amber-500", bgColor: "bg-secondary" },
  DATA_DELIVERED: { label: "Delivered", color: "text-emerald-600", dot: "bg-emerald-500", bgColor: "bg-secondary" },
  COMPLETED: { label: "Completed", color: "text-emerald-600", dot: "bg-emerald-500", bgColor: "bg-secondary" },
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
  const activeOrders = (orderStatusCounts["READY_FOR_SEQUENCING"] || 0) +
    (orderStatusCounts["SEQUENCING_IN_PROGRESS"] || 0) +
    (orderStatusCounts["SEQUENCING_COMPLETED"] || 0) +
    (orderStatusCounts["DATA_PROCESSING"] || 0);
  const completedOrders = (orderStatusCounts["DATA_DELIVERED"] || 0) + (orderStatusCounts["COMPLETED"] || 0);

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
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">
            Welcome back, {session.user.name?.split(" ")[0] || "Researcher"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {sharingMode === "department" && userDepartment
              ? `${userDepartment.name} workspace`
              : "Your sequencing workspace"}
          </p>
        </div>

        {/* Stats at the top */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-card rounded-xl p-4 border border-border text-center">
            <p className="text-2xl font-semibold">{sampleCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total Samples</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border text-center">
            <p className="text-2xl font-semibold">{activeOrders}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Active Orders</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border text-center">
            <p className="text-2xl font-semibold">{completedOrders}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Completed</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <Link
            href="/dashboard/orders/new"
            className="group bg-card rounded-xl p-5 border border-border hover:border-foreground/20 transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">New Order</h3>
                <p className="text-sm text-muted-foreground mt-1">Submit samples for sequencing</p>
              </div>
              <Plus className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </Link>

          <Link
            href="/dashboard/studies/new"
            className="group bg-card rounded-xl p-5 border border-border hover:border-foreground/20 transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">New Study</h3>
                <p className="text-sm text-muted-foreground mt-1">Organize samples for ENA submission</p>
              </div>
              <Plus className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </Link>
        </div>

        {/* Orders and Studies side by side */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Orders Card */}
          <div className="bg-card rounded-xl overflow-hidden border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-semibold">My Orders</h2>
                <p className="text-xs text-muted-foreground">
                  {orderCount} total
                  {draftOrders > 0 && <span className="text-amber-600"> · {draftOrders} draft</span>}
                </p>
              </div>
              <Link href="/dashboard/orders" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {recentOrders.length === 0 ? (
              <div className="text-center py-12 px-5">
                <p className="text-muted-foreground mb-1">No orders yet</p>
                <p className="text-sm text-muted-foreground mb-4">Start by creating your first sequencing order</p>
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
                      className="flex items-center justify-between px-5 py-3.5 hover:bg-secondary/50 transition-colors group"
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
                        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
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
          <div className="bg-card rounded-xl overflow-hidden border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-semibold">My Studies</h2>
                <p className="text-xs text-muted-foreground">
                  {studyCount} total
                  {submittedStudies > 0 && <span className="text-emerald-600"> · {submittedStudies} published</span>}
                </p>
              </div>
              <Link href="/dashboard/studies" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {recentStudies.length === 0 ? (
              <div className="text-center py-12 px-5">
                <p className="text-muted-foreground mb-1">No studies yet</p>
                <p className="text-sm text-muted-foreground mb-4">Create a study to organize samples for ENA</p>
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
                      className="flex items-center justify-between px-5 py-3.5 hover:bg-secondary/50 transition-colors group"
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
                        <span className={`h-2 w-2 rounded-full ${statusDot}`} />
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
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Facility Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of all sequencing activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin">
              Admin Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-xl p-5 border border-border">
          <p className="text-2xl font-bold">{orderCount}</p>
          <p className="text-sm text-muted-foreground">Total Orders</p>
          <div className="flex items-center gap-2 text-xs mt-3">
            <span className="text-amber-600">{activeOrders} active</span>
            <span className="text-muted-foreground">· {draftOrders} draft</span>
          </div>
        </div>

        <div className="bg-card rounded-xl p-5 border border-border">
          <p className="text-2xl font-bold">{studyCount}</p>
          <p className="text-sm text-muted-foreground">Total Studies</p>
          <div className="flex items-center gap-2 text-xs mt-3">
            <span className="text-emerald-600">{submittedStudies} published</span>
            <span className="text-muted-foreground">· {draftStudies} draft</span>
          </div>
        </div>

        <div className="bg-card rounded-xl p-5 border border-border">
          <p className="text-2xl font-bold">{sampleCount}</p>
          <p className="text-sm text-muted-foreground">Total Samples</p>
          <Link href="/dashboard/orders" className="text-xs text-muted-foreground hover:text-foreground mt-3 inline-block transition-colors">
            View in orders
          </Link>
        </div>

        <div className="bg-card rounded-xl p-5 border border-border">
          <p className="text-2xl font-bold">{userCount}</p>
          <p className="text-sm text-muted-foreground">Researchers</p>
          <Link href="/admin/users" className="text-xs text-muted-foreground hover:text-foreground mt-3 inline-block transition-colors">
            Manage users
          </Link>
        </div>
      </div>

      {/* Order Status Breakdown */}
      <div className="bg-card rounded-xl p-5 mb-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Order Pipeline</h2>
          <Link href="/dashboard/orders" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            View all orders <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-3 lg:grid-cols-7 gap-2">
          {Object.entries(ORDER_STATUS_CONFIG).map(([status, config]) => {
            const count = orderStatusCounts[status] || 0;
            return (
              <div key={status} className={`p-3 rounded-lg ${config.bgColor} text-center`}>
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
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-medium">Recent Orders</h3>
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
                      <div className={`px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                        {status.label}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Studies */}
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-medium">Recent Studies</h3>
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
                let statusColor = "bg-secondary text-muted-foreground";

                if (study.submitted) {
                  statusLabel = "Published";
                  statusColor = "bg-secondary text-emerald-600";
                } else if (totalSamples > 0 && !metadataComplete) {
                  statusLabel = `${samplesWithMetadata}/${totalSamples}`;
                  statusColor = "bg-secondary text-amber-600";
                } else if (metadataComplete) {
                  statusLabel = "Ready";
                  statusColor = "bg-secondary text-foreground";
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
                      <div className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground" />
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
