"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ChevronRight,
  Search,
  ArrowUpDown,
  ChevronDown,
  X,
  MoreHorizontal,
  Trash2,
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
  statusNotes: Array<{
    id: string;
    createdAt: string;
  }>;
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
const DATA_HANDLING_SETTINGS_HREF = "/admin/form-builder?tab=settings#data-handling";

function renderOrderDeleteError(message: string): ReactNode {
  if (message !== "Deletion of submitted orders is disabled. Enable it in Settings > Data Handling.") {
    return message;
  }

  return (
    <>
      Deletion of submitted orders is disabled. Enable it in{" "}
      <Link href={DATA_HANDLING_SETTINGS_HREF} className="underline underline-offset-2 text-white">
        Settings &gt; Data Handling
      </Link>
      .
    </>
  );
}

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);

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

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 5) return `${diffWeeks}w ago`;
    return `${diffMonths}mo ago`;
  };

  const getStatusDisplay = (order: Order) => {
    const baseStatus = STATUS_CONFIG[order.status] || STATUS_CONFIG.DRAFT;
    const samplesSent = order.statusNotes.length > 0;

    if (order.status === "SUBMITTED") {
      return {
        ...baseStatus,
        label: samplesSent ? "Submitted · Samples sent" : "Submitted · Awaiting shipment",
      };
    }

    if (order.status === "COMPLETED" && samplesSent) {
      return {
        ...baseStatus,
        label: "Completed · Samples sent",
      };
    }

    return baseStatus;
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

  const handleDeleteClick = (order: Order) => {
    setOrderToDelete(order);
    setDeleteConfirmText("");
    setDeleteDialogOpen(true);
  };

  const selectedOrders = useMemo(
    () => orders.filter((order) => selectedOrderIds.has(order.id)),
    [orders, selectedOrderIds]
  );
  const hasSubmittedSelection = selectedOrders.some((order) => order.status !== "DRAFT");

  const toggleOrderSelection = (orderId: string, checked: boolean) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(orderId);
      } else {
        next.delete(orderId);
      }
      return next;
    });
  };

  const handleBulkDeleteClick = () => {
    if (selectedOrders.length === 0) return;
    setOrderToDelete(null);
    setDeleteConfirmText("");
    setDeleteDialogOpen(true);
  };

  const exitBulkEditMode = () => {
    setBulkEditMode(false);
    setSelectedOrderIds(new Set());
  };

  const handleDeleteConfirm = async () => {
    const targetOrders = orderToDelete ? [orderToDelete] : selectedOrders;
    if (targetOrders.length === 0) return;

    const isSubmitted = targetOrders.some((order) => order.status !== "DRAFT");
    if (isSubmitted && deleteConfirmText !== "DELETE") {
      setError("You must type DELETE to confirm deletion of submitted orders.");
      return;
    }

    setDeletingOrder(true);
    setError("");

    try {
      const results = await Promise.all(
        targetOrders.map(async (order) => {
          const res = await fetch(`/api/orders/${order.id}`, {
            method: "DELETE",
          });

          if (res.ok) {
            return { id: order.id, ok: true as const };
          }

          const data = await res.json().catch(() => ({}));
          return {
            id: order.id,
            ok: false as const,
            error: data.error || `Failed to delete ${order.orderNumber}`,
          };
        })
      );

      const deletedIds = results.filter((result) => result.ok).map((result) => result.id);
      const failed = results.filter((result) => !result.ok);

      if (deletedIds.length > 0) {
        setOrders((prev) => prev.filter((order) => !deletedIds.includes(order.id)));
        setSelectedOrderIds((prev) => {
          const next = new Set(prev);
          deletedIds.forEach((id) => next.delete(id));
          return next;
        });
      }

      if (failed.length > 0) {
        setError(failed[0].error || "Failed to delete some orders");
        return;
      }

      setDeleteDialogOpen(false);
      setOrderToDelete(null);
      setDeleteConfirmText("");
    } catch {
      setError("Failed to delete order");
    } finally {
      setDeletingOrder(false);
    }
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
          <div className="flex items-center gap-2">
            {isFacilityAdmin && (
              bulkEditMode ? (
                <Button size="sm" variant="outline" onClick={exitBulkEditMode}>
                  Done
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setBulkEditMode(true)}>
                  Edit Multiple
                </Button>
              )
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href="/orders/new">
                New Order
              </Link>
            </Button>
          </div>
        )}
      </div>

      <HelpBox title="What are orders?">
        An order represents a sequencing request submitted to the facility.
        It contains sample information, sequencing parameters, and tracks the progress from submission through to data delivery.
      </HelpBox>

      {error && <ErrorBanner message={renderOrderDeleteError(error)} />}

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
              <Link href="/orders/new">
                New Order
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {isFacilityAdmin && bulkEditMode && selectedOrders.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {selectedOrders.length} order{selectedOrders.length !== 1 ? "s" : ""} selected
              </p>
              <Button size="sm" variant="destructive" onClick={handleBulkDeleteClick}>
                Delete Selected
              </Button>
            </div>
          )}

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
              className="col-span-3 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Order
              {sortField === "name" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={() => handleSort("status")}
              className="col-span-3 flex items-center gap-1 hover:text-foreground transition-colors text-left"
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
              const statusConfig = getStatusDisplay(order);
              const isSelected = selectedOrderIds.has(order.id);

              return (
                <div
                  key={order.id}
                  className={`px-4 py-3 transition-colors group md:grid md:grid-cols-12 md:gap-4 md:px-5 md:py-4 md:items-center ${
                    bulkEditMode
                      ? `${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-secondary/80"} cursor-pointer`
                      : "hover:bg-secondary/80"
                  }`}
                  onClick={bulkEditMode ? () => toggleOrderSelection(order.id, !isSelected) : undefined}
                >
                  {/* Mobile layout */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      {bulkEditMode ? (
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
                      ) : (
                        <Link href={`/orders/${order.id}`} className="min-w-0 flex-1">
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
                        </Link>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {bulkEditMode ? (
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                            <div className="text-right">
                              <span className={`text-xs font-medium ${statusConfig.color}`}>
                                {statusConfig.label}
                              </span>
                              <p className="text-[10px] text-muted-foreground">
                                {formatTimeAgo(order.statusUpdatedAt)}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <Link href={`/orders/${order.id}`} className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                            <div className="text-right">
                              <span className={`text-xs font-medium ${statusConfig.color}`}>
                                {statusConfig.label}
                              </span>
                              <p className="text-[10px] text-muted-foreground">
                                {formatTimeAgo(order.statusUpdatedAt)}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                          </Link>
                        )}
                        {isFacilityAdmin && !bulkEditMode && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Options for ${order.name || order.orderNumber}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDeleteClick(order)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete order
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden md:contents">
                    {/* Order Info */}
                    <div className="col-span-3 min-w-0">
                      {bulkEditMode ? (
                        <>
                          <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {order.name || order.orderNumber}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {order.orderNumber}
                          </p>
                        </>
                      ) : (
                        <Link href={`/orders/${order.id}`}>
                          <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {order.name || order.orderNumber}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {order.orderNumber}
                          </p>
                        </Link>
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-3 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <span className={`text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 ml-4">
                        {formatTimeAgo(order.statusUpdatedAt)}
                      </p>
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

                    {isFacilityAdmin ? (
                      <div className="col-span-1 flex justify-end">
                        {bulkEditMode ? (
                          <div className="h-8 w-8" />
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Options for ${order.name || order.orderNumber}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDeleteClick(order)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete order
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    ) : (
                      <div className="col-span-1 flex justify-end">
                        {!bulkEditMode && (
                          <Link href={`/orders/${order.id}`}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setOrderToDelete(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Order</DialogTitle>
            <DialogDescription asChild>
              <div>
                {(orderToDelete ? orderToDelete.status !== "DRAFT" : hasSubmittedSelection) ? (
                  <>
                    <p className="mb-2">
                      <strong>Warning:</strong> {orderToDelete
                        ? `This order has been submitted (status: ${orderToDelete.status}).`
                        : "One or more selected orders have already been submitted."}
                    </p>
                    <p className="mb-2">Deleting will permanently remove:</p>
                    <ul className="mb-4 list-inside list-disc text-sm">
                      <li>
                        {orderToDelete
                          ? orderToDelete._count.samples || 0
                          : selectedOrders.reduce((sum, order) => sum + order._count.samples, 0)}{" "}
                        samples
                      </li>
                      <li>All associated sequencing data</li>
                      <li>Status history</li>
                    </ul>
                    <p className="mb-2">
                      This cannot be undone. Type <strong>DELETE</strong> to confirm.
                    </p>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="Type DELETE to confirm"
                      className="mt-2"
                    />
                  </>
                ) : (
                  <p>
                    Are you sure you want to delete{" "}
                    {orderToDelete ? "this order" : `${selectedOrders.length} selected orders`}?
                    This cannot be undone.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setOrderToDelete(null);
                setDeleteConfirmText("");
              }}
              disabled={deletingOrder}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deletingOrder || ((orderToDelete ? orderToDelete.status !== "DRAFT" : hasSubmittedSelection) && deleteConfirmText !== "DELETE")}
            >
              {deletingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
