import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Calendar,
  FileText,
  BookOpen,
  ChevronRight,
} from "lucide-react";

interface UserProfilePageProps {
  params: Promise<{ id: string }>;
}

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    redirect("/dashboard");
  }

  const user = await db.user.findUnique({
    where: { id },
    include: {
      department: true,
      orders: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          _count: { select: { samples: true } },
        },
      },
      studies: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          _count: { select: { samples: true } },
        },
      },
      _count: {
        select: {
          orders: true,
          studies: true,
        },
      },
    },
  });

  if (!user) {
    notFound();
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const roleLabels: Record<string, string> = {
    FACILITY_ADMIN: "Facility Admin",
    RESEARCHER: "Researcher",
  };

  const researcherRoleLabels: Record<string, string> = {
    PI: "Principal Investigator",
    POSTDOC: "Postdoc",
    PHD_STUDENT: "PhD Student",
    MASTER_STUDENT: "Master Student",
    TECHNICIAN: "Technician",
    OTHER: "Other",
  };

  const statusConfig: Record<string, { label: string; color: string }> = {
    DRAFT: { label: "Draft", color: "bg-stone-100 text-stone-600" },
    SUBMITTED: { label: "Submitted", color: "bg-blue-50 text-blue-700" },
    IN_PROGRESS: { label: "In Progress", color: "bg-amber-50 text-amber-700" },
    SEQUENCING: { label: "Sequencing", color: "bg-purple-50 text-purple-700" },
    COMPLETED: { label: "Completed", color: "bg-emerald-50 text-emerald-700" },
    CANCELLED: { label: "Cancelled", color: "bg-red-50 text-red-700" },
  };

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Link>

        <div className="flex items-start gap-4">
          <div
            className="h-16 w-16 rounded-full flex items-center justify-center text-xl font-medium text-white shrink-0"
            style={{ backgroundColor: '#1e3a8a' }}
          >
            {user.firstName.charAt(0)}{user.lastName.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold">
                {user.firstName} {user.lastName}
              </h1>
              <Badge variant={user.role === "FACILITY_ADMIN" ? "default" : "secondary"}>
                {roleLabels[user.role] || user.role}
              </Badge>
            </div>
            {user.researcherRole && (
              <p className="text-muted-foreground">
                {researcherRoleLabels[user.researcherRole] || user.researcherRole}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Contact Information</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <a href={`mailto:${user.email}`} className="text-sm hover:text-primary transition-colors">
                {user.email}
              </a>
            </div>
            {user.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{user.phone}</span>
              </div>
            )}
            {user.department && (
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{user.department.name}</span>
              </div>
            )}
            {user.institution && (
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{user.institution}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Activity</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-semibold">{user._count.orders}</p>
              <p className="text-xs text-muted-foreground">Orders</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{user._count.studies}</p>
              <p className="text-xs text-muted-foreground">Studies</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-stone-100">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              Joined {formatDateTime(user.createdAt)}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="text-sm font-medium">Recent Orders</h2>
          {user._count.orders > 10 && (
            <Link href={`/dashboard/orders?user=${user.id}`} className="text-xs text-primary hover:underline">
              View all
            </Link>
          )}
        </div>

        {user.orders.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No orders yet
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {user.orders.map((order) => (
              <Link
                key={order.id}
                href={`/dashboard/orders/${order.id}`}
                className="flex items-center gap-4 px-5 py-3 hover:bg-stone-50 transition-colors group"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {order.name || order.orderNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order._count.samples} samples · {formatDate(order.createdAt)}
                  </p>
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${statusConfig[order.status]?.color || "bg-stone-100 text-stone-600"}`}>
                  {statusConfig[order.status]?.label || order.status}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Studies */}
      <div className="bg-white rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="text-sm font-medium">Recent Studies</h2>
          {user._count.studies > 10 && (
            <Link href={`/dashboard/studies?user=${user.id}`} className="text-xs text-primary hover:underline">
              View all
            </Link>
          )}
        </div>

        {user.studies.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No studies yet
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {user.studies.map((study) => (
              <Link
                key={study.id}
                href={`/dashboard/studies/${study.id}`}
                className="flex items-center gap-4 px-5 py-3 hover:bg-stone-50 transition-colors group"
              >
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {study.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {study._count.samples} samples · {formatDate(study.createdAt)}
                  </p>
                </div>
                {study.submitted ? (
                  <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[10px]">
                    Submitted
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    Draft
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
