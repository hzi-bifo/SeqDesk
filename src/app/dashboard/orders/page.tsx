"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import {
  Loader2,
  ChevronRight,
  Search,
  ArrowUpDown,
  ChevronDown,
  X,
} from "lucide-react";
import { ErrorBanner } from "@/components/ui/error-banner";

interface Order {
  id: string;
  orderNumber: string;
  name: string | null;
  status: string;
  statusUpdatedAt: string;
  createdAt: string;
  platform: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  _count: {
    samples: number;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "text-muted-foreground", dot: "bg-muted-foreground" },
  SUBMITTED: { label: "Submitted", color: "text-blue-600", dot: "bg-blue-500" },
  COMPLETED: { label: "Completed", color: "text-emerald-600", dot: "bg-emerald-500" },
};

type SortField = "created" | "name" | "status" | "samples";
type SortDirection = "asc" | "desc";

const STATUS_ORDER = ["DRAFT", "SUBMITTED", "COMPLETED"];

export default function OrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("created");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sharingMode, setSharingMode] = useState<"personal" | "department" | "all">("personal");

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";
  const canCreateOrder = isResearcher || isFacilityAdmin;

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error("Failed to fetch orders");
        const data = await res.json();
        setOrders(data.orders || data);
        setSharingMode(data.sharingMode || "personal");
      } catch {
        setError("Failed to load orders");
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get unique users for filter dropdown
  const uniqueUsers = useMemo(() => {
    const users = new Map<string, { id: string; name: string }>();
    orders.forEach((order) => {
      if (!users.has(order.user.id)) {
        users.set(order.user.id, {
          id: order.user.id,
          name: `${order.user.firstName} ${order.user.lastName}`,
        });
      }
    });
    return Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  // Filter and sort orders
  const filteredOrders = useMemo(() => {
    const result = orders.filter((order) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          order.orderNumber.toLowerCase().includes(query) ||
          order.name?.toLowerCase().includes(query) ||
          order.user.firstName.toLowerCase().includes(query) ||
          order.user.lastName.toLowerCase().includes(query) ||
          order.user.email.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter && order.status !== statusFilter) return false;

      // User filter
      if (userFilter && order.user.id !== userFilter) return false;

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "created":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "name":
          comparison = (a.name || a.orderNumber).localeCompare(b.name || b.orderNumber);
          break;
        case "status":
          comparison = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
          break;
        case "samples":
          comparison = a._count.samples - b._count.samples;
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [orders, searchQuery, statusFilter, userFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setUserFilter("");
  };

  const hasActiveFilters = searchQuery || statusFilter || userFilter;

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">
            {isFacilityAdmin ? "All Orders" : sharingMode === "department" ? "Department Orders" : "My Orders"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {orders.length} order{orders.length !== 1 ? "s" : ""}
            {isResearcher && sharingMode === "department" && " from your department"}
          </p>
        </div>
        {canCreateOrder && (
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/orders/new">
              New Order
            </Link>
          </Button>
        )}
      </div>

      <HelpBox title="What are orders?">
        An order represents a sequencing request submitted to the facility.
        It contains sample information, sequencing parameters, and tracks the progress from submission through to data delivery.
      </HelpBox>

      {error && <ErrorBanner message={error} />}

      {orders.length === 0 ? (
        <div className="bg-card rounded-xl p-12 text-center border border-border">
          <h2 className="text-lg font-medium mb-2">No orders yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {isResearcher
              ? "Orders contain your samples for sequencing. Create an order, add samples, then mark it as ready for the sequencing facility."
              : "Orders contain samples for sequencing. Create an order, add samples, then mark it as ready when preparation is complete."}
          </p>
          {canCreateOrder && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/orders/new">
                New Order
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {/* Search & Filters */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search orders..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {/* Status Filter */}
                <div className="relative flex-1 sm:flex-none">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full sm:w-auto appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                  >
                    <option value="">All Status</option>
                    {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>

                {/* User Filter (Admin only) */}
                {isFacilityAdmin && (
                  <div className="relative flex-1 sm:flex-none">
                    <select
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                      className="w-full sm:w-auto appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      <option value="">All Researchers</option>
                      {uniqueUsers.map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                )}

                {/* Clear Filters */}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>

              {/* Mobile sort controls */}
              <div className="flex items-center gap-2 md:hidden">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="flex-1 appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="created">Sort: Created</option>
                  <option value="name">Sort: Name</option>
                  <option value="status">Sort: Status</option>
                  <option value="samples">Sort: Samples</option>
                </select>
                <button
                  onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                  className="px-3 py-2 text-xs bg-secondary rounded-lg border border-border hover:bg-secondary/80 transition-colors shrink-0"
                >
                  {sortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
          </div>

          {/* Table Header - hidden on mobile */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-border bg-secondary/50 text-xs font-medium text-muted-foreground">
            <button
              onClick={() => handleSort("name")}
              className="col-span-4 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Order
              {sortField === "name" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={() => handleSort("status")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Status
              {sortField === "status" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            {isFacilityAdmin && <div className="col-span-2">Researcher</div>}
            <button
              onClick={() => handleSort("samples")}
              className={`${isFacilityAdmin ? "col-span-1" : "col-span-2"} flex items-center gap-1 hover:text-foreground transition-colors justify-end`}
            >
              {sortField === "samples" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
              Samples
            </button>
            <button
              onClick={() => handleSort("created")}
              className={`${isFacilityAdmin ? "col-span-2" : "col-span-3"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
            >
              Created
              {sortField === "created" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            <div className="col-span-1"></div>
          </div>

          {/* Orders List */}
          <div className="divide-y divide-border">
            {filteredOrders.map((order) => {
              const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;

              return (
                <Link
                  key={order.id}
                  href={`/dashboard/orders/${order.id}`}
                  className="block px-4 py-3 hover:bg-secondary/80 transition-colors group md:grid md:grid-cols-12 md:gap-4 md:px-5 md:py-4 md:items-center"
                >
                  {/* Mobile layout */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {order.name || order.orderNumber}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {order.orderNumber} · {order._count.samples} samples · {formatDate(order.createdAt)}
                        </p>
                        {isFacilityAdmin && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {order.user.firstName} {order.user.lastName}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <span className={`text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden md:contents">
                    {/* Order Info */}
                    <div className="col-span-4 min-w-0">
                      <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                        {order.name || order.orderNumber}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {order.orderNumber}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <span className={`text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </div>
                    </div>

                    {/* Researcher (Admin only) */}
                    {isFacilityAdmin && (
                      <div className="col-span-2 min-w-0">
                        <p className="text-sm truncate">
                          {order.user.firstName} {order.user.lastName}
                        </p>
                      </div>
                    )}

                    {/* Samples */}
                    <div className={`${isFacilityAdmin ? "col-span-1" : "col-span-2"} text-right`}>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {order._count.samples}
                      </span>
                    </div>

                    {/* Date */}
                    <div className={isFacilityAdmin ? "col-span-2" : "col-span-3"}>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(order.createdAt)}
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="col-span-1 flex justify-end">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {filteredOrders.length === 0 && hasActiveFilters && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">No orders match your filters</p>
              <button
                onClick={clearFilters}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
