"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  ChevronRight,
  Search,
  ArrowUpDown,
  ChevronDown,
  X,
  Loader2,
  Users,
} from "lucide-react";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  researcherRole: string | null;
  createdAt: string;
  department: {
    id: string;
    name: string;
  } | null;
  _count: {
    orders: number;
    studies: number;
  };
}

const ROLE_LABELS: Record<string, string> = {
  PI: "PI",
  POSTDOC: "Postdoc",
  PHD_STUDENT: "PhD Student",
  MASTER_STUDENT: "Master Student",
  TECHNICIAN: "Technician",
  OTHER: "Other",
};

type SortField = "name" | "position" | "department" | "orders" | "studies" | "joined";
type SortDirection = "asc" | "desc";

export default function UsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [positionFilter, setPositionFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("joined");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      router.push("/dashboard");
      return;
    }

    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        setUsers(data);
      } catch {
        console.error("Failed to load users");
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [session, status, router]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get unique departments for filter
  const uniqueDepartments = useMemo(() => {
    const depts = new Map<string, string>();
    users.forEach((user) => {
      if (user.department) {
        depts.set(user.department.id, user.department.name);
      }
    });
    return Array.from(depts.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  // Get unique positions for filter
  const uniquePositions = useMemo(() => {
    const positions = new Set<string>();
    users.forEach((user) => {
      if (user.researcherRole) {
        positions.add(user.researcherRole);
      }
    });
    return Array.from(positions).sort((a, b) =>
      (ROLE_LABELS[a] || a).localeCompare(ROLE_LABELS[b] || b)
    );
  }, [users]);

  // Filter and sort users
  const filteredUsers = useMemo(() => {
    let result = users.filter((user) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          user.firstName.toLowerCase().includes(query) ||
          user.lastName.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query) ||
          user.department?.name.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Department filter
      if (departmentFilter && user.department?.id !== departmentFilter) return false;

      // Position filter
      if (positionFilter && user.researcherRole !== positionFilter) return false;

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
          break;
        case "position":
          comparison = (ROLE_LABELS[a.researcherRole || ""] || "zzz").localeCompare(
            ROLE_LABELS[b.researcherRole || ""] || "zzz"
          );
          break;
        case "department":
          comparison = (a.department?.name || "zzz").localeCompare(b.department?.name || "zzz");
          break;
        case "orders":
          comparison = a._count.orders - b._count.orders;
          break;
        case "studies":
          comparison = a._count.studies - b._count.studies;
          break;
        case "joined":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [users, searchQuery, departmentFilter, positionFilter, sortField, sortDirection]);

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
    setDepartmentFilter("");
    setPositionFilter("");
  };

  const hasActiveFilters = searchQuery || departmentFilter || positionFilter;

  if (loading || status === "loading") {
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
          <h1 className="text-xl font-semibold">Researchers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {users.length} registered researcher{users.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-lg font-medium mb-2">No researchers yet</h2>
          <p className="text-sm text-muted-foreground">
            Researchers will appear here once they register
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden">
          {/* Search & Filters */}
          <div className="px-4 py-3 border-b border-stone-100">
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search researchers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-stone-50 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Department Filter */}
              {uniqueDepartments.length > 0 && (
                <div className="relative">
                  <select
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className="appearance-none pl-3 pr-8 py-2 text-sm bg-stone-50 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                  >
                    <option value="">All Departments</option>
                    {uniqueDepartments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              )}

              {/* Position Filter */}
              {uniquePositions.length > 0 && (
                <div className="relative">
                  <select
                    value={positionFilter}
                    onChange={(e) => setPositionFilter(e.target.value)}
                    className="appearance-none pl-3 pr-8 py-2 text-sm bg-stone-50 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                  >
                    <option value="">All Positions</option>
                    {uniquePositions.map((pos) => (
                      <option key={pos} value={pos}>{ROLE_LABELS[pos] || pos}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              )}

              {/* Clear Filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50/50 text-xs font-medium text-muted-foreground">
            <button
              onClick={() => handleSort("name")}
              className="col-span-3 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Researcher
              {sortField === "name" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => handleSort("position")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Position
              {sortField === "position" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => handleSort("department")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Department
              {sortField === "department" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => handleSort("orders")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors justify-end"
            >
              {sortField === "orders" && <ArrowUpDown className="h-3 w-3" />}
              Orders
            </button>
            <button
              onClick={() => handleSort("studies")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors justify-end"
            >
              {sortField === "studies" && <ArrowUpDown className="h-3 w-3" />}
              Studies
            </button>
            <button
              onClick={() => handleSort("joined")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Joined
              {sortField === "joined" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <div className="col-span-1"></div>
          </div>

          {/* Users List */}
          <div className="divide-y divide-stone-100">
            {filteredUsers.map((user) => (
              <Link
                key={user.id}
                href={`/admin/users/${user.id}`}
                className="grid grid-cols-12 gap-4 px-5 py-3.5 hover:bg-stone-50/80 transition-colors group items-center"
              >
                {/* User Info */}
                <div className="col-span-3 flex items-center gap-3 min-w-0">
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                    style={{ backgroundColor: '#1e3a8a' }}
                  >
                    {user.firstName.charAt(0)}{user.lastName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </div>

                {/* Position */}
                <div className="col-span-2">
                  <span className="text-sm text-muted-foreground">
                    {user.researcherRole ? ROLE_LABELS[user.researcherRole] || user.researcherRole : <span className="text-stone-300">-</span>}
                  </span>
                </div>

                {/* Department */}
                <div className="col-span-2 min-w-0">
                  <span className="text-sm text-muted-foreground truncate block">
                    {user.department?.name || <span className="text-stone-300">-</span>}
                  </span>
                </div>

                {/* Orders */}
                <div className="col-span-1 text-right">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {user._count.orders}
                  </span>
                </div>

                {/* Studies */}
                <div className="col-span-1 text-right">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {user._count.studies}
                  </span>
                </div>

                {/* Joined */}
                <div className="col-span-2">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatDate(user.createdAt)}
                  </span>
                </div>

                {/* Arrow */}
                <div className="col-span-1 flex justify-end">
                  <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-stone-400 transition-colors" />
                </div>
              </Link>
            ))}
          </div>

          {filteredUsers.length === 0 && hasActiveFilters && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">No researchers match your filters</p>
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
