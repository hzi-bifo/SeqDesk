"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  Download,
  Globe,
  AlertTriangle,
  CheckCircle2,
  Search,
  ArrowUpDown,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
} from "lucide-react";

interface Department {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { users: number };
}

interface ExtractedDepartment {
  name: string;
  description: string | null;
  isDuplicate?: boolean;
  selected?: boolean;
}

type SortField = "name" | "users" | "status" | "created";
type SortDirection = "asc" | "desc";

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [departmentToDelete, setDepartmentToDelete] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);

  // AI Import state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [savedImportUrl, setSavedImportUrl] = useState<string | null>(null);
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractedDepts, setExtractedDepts] = useState<ExtractedDepartment[]>([]);
  const [extractionSource, setExtractionSource] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState("");

  const fetchDepartments = async () => {
    try {
      const res = await fetch("/api/admin/departments");
      const data = await res.json();
      setDepartments(data);
    } catch {
      setError("Failed to load departments");
    } finally {
      setLoading(false);
    }
  };

  const fetchSavedImportUrl = async () => {
    try {
      const res = await fetch("/api/admin/departments/import-url");
      const data = await res.json();
      if (data.url) {
        setSavedImportUrl(data.url);
        setLastImportedAt(data.lastImportedAt);
      }
    } catch {
      // Ignore errors
    }
  };

  const saveImportUrl = async (url: string) => {
    try {
      await fetch("/api/admin/departments/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      setSavedImportUrl(url);
      setLastImportedAt(new Date().toISOString());
    } catch {
      // Ignore errors
    }
  };

  useEffect(() => {
    fetchDepartments();
    fetchSavedImportUrl();
  }, []);

  // Filter and sort departments
  const filteredDepartments = useMemo(() => {
    let result = departments.filter((dept) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          dept.name.toLowerCase().includes(query) ||
          dept.description?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter) {
        if (statusFilter === "active" && !dept.isActive) return false;
        if (statusFilter === "inactive" && dept.isActive) return false;
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "users":
          comparison = (a._count?.users || 0) - (b._count?.users || 0);
          break;
        case "status":
          comparison = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
          break;
        case "created":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [departments, searchQuery, statusFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
  };

  const hasActiveFilters = searchQuery || statusFilter;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setEditingId(null);
    setShowForm(false);
    setError("");
  };

  const handleEdit = (dept: Department) => {
    setName(dept.name);
    setDescription(dept.description || "");
    setEditingId(dept.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const url = editingId
        ? `/api/admin/departments/${editingId}`
        : "/api/admin/departments";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save department");
        return;
      }

      await fetchDepartments();
      resetForm();
    } catch {
      setError("Failed to save department");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (dept: Department) => {
    try {
      await fetch(`/api/admin/departments/${dept.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !dept.isActive }),
      });
      await fetchDepartments();
    } catch {
      setError("Failed to update department");
    }
  };

  const openDeleteDialog = (dept: Department) => {
    setDepartmentToDelete(dept);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!departmentToDelete) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/departments/${departmentToDelete.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete department");
        return;
      }

      await fetchDepartments();
      setDeleteDialogOpen(false);
      setDepartmentToDelete(null);
    } catch {
      setError("Failed to delete department");
    } finally {
      setDeleting(false);
    }
  };

  // AI Import functions
  const openImportDialog = () => {
    // Pre-fill with saved URL if available
    if (savedImportUrl) {
      setImportUrl(savedImportUrl);
    }
    setShowImportDialog(true);
  };

  const resetImportDialog = () => {
    setImportUrl("");
    setExtractedDepts([]);
    setExtractionSource(null);
    setImportError("");
    setImportSuccess("");
    setShowImportDialog(false);
  };

  const handleExtract = async (urlToUse?: string) => {
    const url = urlToUse || importUrl.trim();
    if (!url) {
      setImportError("Please enter a URL");
      return;
    }

    setImportUrl(url);
    setExtracting(true);
    setImportError("");
    setExtractedDepts([]);
    setExtractionSource(null);

    try {
      const res = await fetch("/api/admin/departments/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        setImportError(data.error || "Failed to extract departments");
        return;
      }

      // Save the URL for future use
      await saveImportUrl(url);

      const deptsWithSelection = data.departments.map((d: ExtractedDepartment) => ({
        ...d,
        selected: !d.isDuplicate,
      }));

      setExtractedDepts(deptsWithSelection);
      setExtractionSource(data.sourceInfo);
    } catch {
      setImportError("Failed to extract departments");
    } finally {
      setExtracting(false);
    }
  };

  const toggleDeptSelection = (index: number) => {
    setExtractedDepts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, selected: !d.selected } : d))
    );
  };

  const handleImportSelected = async () => {
    const toImport = extractedDepts.filter((d) => d.selected && !d.isDuplicate);

    if (toImport.length === 0) {
      setImportError("No departments selected for import");
      return;
    }

    setImporting(true);
    setImportError("");

    let successCount = 0;
    let errorCount = 0;

    for (const dept of toImport) {
      try {
        const res = await fetch("/api/admin/departments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: dept.name,
            description: dept.description || null,
          }),
        });

        if (res.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setImporting(false);

    if (successCount > 0) {
      setImportSuccess(`Successfully imported ${successCount} department${successCount > 1 ? "s" : ""}`);
      await fetchDepartments();

      setExtractedDepts((prev) =>
        prev.map((d) => (d.selected && !d.isDuplicate ? { ...d, isDuplicate: true, selected: false } : d))
      );
    }

    if (errorCount > 0) {
      setImportError(`Failed to import ${errorCount} department${errorCount > 1 ? "s" : ""}`);
    }
  };

  const selectedCount = extractedDepts.filter((d) => d.selected && !d.isDuplicate).length;

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
          <h1 className="text-xl font-semibold">Departments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {departments.length} department{departments.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openImportDialog}>
            <Download className="h-4 w-4 mr-1.5" />
            AI Import
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Department
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          {error}
          <button onClick={() => setError("")} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {departments.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-lg font-medium mb-2">No departments yet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Add departments to organize your researchers
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={openImportDialog}>
              <Download className="h-4 w-4 mr-1.5" />
              AI Import
            </Button>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Department
            </Button>
          </div>
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
                  placeholder="Search departments..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-stone-50 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Status Filter */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm bg-stone-50 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>

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
              className="col-span-6 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Department
              {sortField === "name" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => handleSort("status")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Status
              {sortField === "status" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => handleSort("users")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors justify-end"
            >
              {sortField === "users" && <ArrowUpDown className="h-3 w-3" />}
              Users
            </button>
            <button
              onClick={() => handleSort("created")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Created
              {sortField === "created" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {/* Departments List */}
          <div className="divide-y divide-stone-100">
            {filteredDepartments.map((dept) => (
              <div
                key={dept.id}
                className={`grid grid-cols-12 gap-4 px-5 py-3.5 hover:bg-stone-50/80 transition-colors items-center ${
                  !dept.isActive ? "opacity-60" : ""
                }`}
              >
                {/* Department Info */}
                <div className="col-span-6 min-w-0">
                  <p className="font-medium text-sm truncate">{dept.name}</p>
                  {dept.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {dept.description}
                    </p>
                  )}
                </div>

                {/* Status */}
                <div className="col-span-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${dept.isActive ? "bg-emerald-500" : "bg-stone-400"}`} />
                    <span className={`text-xs font-medium ${dept.isActive ? "text-emerald-600" : "text-stone-600"}`}>
                      {dept.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>

                {/* Users */}
                <div className="col-span-1 text-right">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {dept._count?.users || 0}
                  </span>
                </div>

                {/* Created */}
                <div className="col-span-2">
                  <span className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDate(dept.createdAt)}
                  </span>
                </div>

                {/* Actions */}
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button
                    onClick={() => handleToggleActive(dept)}
                    className="p-1.5 rounded-md hover:bg-stone-100 transition-colors"
                    title={dept.isActive ? "Deactivate" : "Activate"}
                  >
                    <span className={`block h-3 w-3 rounded-full border-2 ${dept.isActive ? "bg-emerald-500 border-emerald-500" : "bg-transparent border-stone-400"}`} />
                  </button>
                  <button
                    onClick={() => handleEdit(dept)}
                    className="p-1.5 rounded-md hover:bg-stone-100 transition-colors text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openDeleteDialog(dept)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredDepartments.length === 0 && hasActiveFilters && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">No departments match your filters</p>
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

      {/* Add/Edit Department Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Department" : "Add Department"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Department Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Computational Biology"
                required
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the department"
                disabled={saving}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    {editingId ? "Update" : "Create"}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AI Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={(open) => !open && resetImportDialog()}>
        <DialogContent className="!w-[90vw] !max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              AI Import Departments
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            This tool fetches the webpage content and uses AI to extract department names.
            Make sure the webpage is publicly accessible or that you have permission for it to be accessed by this system.
          </p>

          <div className="space-y-6 py-4">
            {/* Saved URL - Re-fetch option */}
            {savedImportUrl && !extractedDepts.length && (
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-blue-900">Previously imported from:</p>
                    <p className="text-xs text-blue-700 truncate">{savedImportUrl}</p>
                    {lastImportedAt && (
                      <p className="text-xs text-blue-600 mt-0.5">
                        Last used: {new Date(lastImportedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExtract(savedImportUrl)}
                    disabled={extracting}
                    className="shrink-0 border-blue-200 text-blue-700 hover:bg-blue-100"
                  >
                    {extracting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        Re-fetch
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* URL Input */}
            <div className="space-y-2">
              <Label>{savedImportUrl ? "Or enter a different URL" : "Webpage URL"}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://institute.edu/departments"
                    className="pl-10"
                    disabled={extracting}
                    onKeyDown={(e) => e.key === "Enter" && !extracting && handleExtract()}
                  />
                </div>
                <Button onClick={() => handleExtract()} disabled={extracting || !importUrl.trim()}>
                  {extracting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    "Extract"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste a URL to a webpage listing departments or research groups. The AI will extract department names and descriptions.
              </p>
            </div>

            {/* Error */}
            {importError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {importError}
              </div>
            )}

            {/* Success */}
            {importSuccess && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {importSuccess}
              </div>
            )}

            {/* Extracted Departments */}
            {extractedDepts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Extracted Departments</h3>
                    {extractionSource && (
                      <p className="text-xs text-muted-foreground">{extractionSource}</p>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {selectedCount} selected for import
                  </span>
                </div>

                <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
                  {extractedDepts.map((dept, index) => (
                    <div
                      key={index}
                      className={`p-3 flex items-start gap-3 ${
                        dept.isDuplicate ? "bg-muted/30" : "hover:bg-muted/20"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={dept.selected || false}
                        onChange={() => toggleDeptSelection(index)}
                        disabled={dept.isDuplicate}
                        className="mt-1 h-4 w-4 rounded border-input"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${dept.isDuplicate ? "text-muted-foreground" : ""}`}>
                            {dept.name}
                          </span>
                          {dept.isDuplicate && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-600">
                              Already exists
                            </span>
                          )}
                        </div>
                        {dept.description && (
                          <p className="text-sm text-muted-foreground mt-0.5 truncate">
                            {dept.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {extractedDepts.every((d) => d.isDuplicate) && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    All extracted departments already exist in the system.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetImportDialog}>
              Cancel
            </Button>
            {extractedDepts.length > 0 && selectedCount > 0 && (
              <Button onClick={handleImportSelected} disabled={importing}>
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Import {selectedCount} Department{selectedCount > 1 ? "s" : ""}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Department</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{departmentToDelete?.name}&quot;?
              {departmentToDelete?._count?.users ? (
                <span className="block mt-2 text-amber-600">
                  Warning: This department has {departmentToDelete._count.users} user{departmentToDelete._count.users !== 1 ? "s" : ""} assigned to it.
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
