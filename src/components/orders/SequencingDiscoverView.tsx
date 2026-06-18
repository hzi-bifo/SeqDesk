"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notifyPanel } from "@/lib/notifications/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpBox } from "@/components/ui/help-box";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  HardDrive,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  SequencingDiscoveryResult,
  SequencingDiscoveryScanWarnings,
  SequencingSampleRow,
} from "@/lib/sequencing/types";
import {
  READ_DATA_CLASS_BADGE_CLASSNAMES,
  READ_DATA_CLASS_LABELS,
  READ_DATA_CLASSES,
  READ_ORIGIN_BADGE_CLASSNAMES,
  type ReadDataClass,
  type ReadOrigin,
} from "@/lib/sequencing/constants";

interface StorageFile {
  relativePath: string;
  filename: string;
  size: number;
  modifiedAt: string;
  assignedTo?: {
    sampleId: string;
    orderId: string;
    orderName: string | null;
    role: "R1" | "R2";
  } | null;
}

interface SequencingDiscoverViewProps {
  orderId: string;
  samples: SequencingSampleRow[];
  canManage: boolean;
  dataBasePathConfigured: boolean;
  onDataChanged: () => void;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getAssignmentFailureMessage(payload: any, fallback: string): string | null {
  if (payload?.error) return String(payload.error);
  if (payload?.success === false) {
    const failures = Array.isArray(payload.results)
      ? payload.results.filter((result: any) => result && result.success === false)
      : [];
    if (failures.length > 0) {
      return failures
        .slice(0, 3)
        .map((failure: any) =>
          failure?.sampleId && failure?.error
            ? `${failure.sampleId}: ${failure.error}`
            : failure?.error || fallback
        )
        .join("; ");
    }
    return fallback;
  }
  return null;
}

function getBarcodeSourceLabel(
  source?: SequencingSampleRow["plannedBarcodeSource"]
): string | null {
  if (source === "run-plan") return "Run plan";
  if (source === "sample-barcode") return "Sequencing Order barcode";
  return null;
}

function getMatchSourceLabel(
  matchedBy?: SequencingDiscoveryResult["suggestion"]["matchedBy"]
): string | null {
  if (matchedBy === "run-plan-barcode") return "matched by run-plan barcode";
  if (matchedBy === "sample-barcode") return "matched by sequencing order barcode";
  if (matchedBy === "sample-id") return "matched by sample ID or alias";
  return null;
}

function getReadDataClassBadgeClassName(dataClass: ReadDataClass) {
  return READ_DATA_CLASS_BADGE_CLASSNAMES[dataClass];
}

function getReadOriginBadgeClassName(origin: ReadOrigin) {
  return READ_ORIGIN_BADGE_CLASSNAMES[origin];
}

function readFileMissing(
  sample: SequencingSampleRow,
  field: "file1" | "file2"
): boolean {
  if (!sample.read?.filesMissing || !sample.read[field]) return false;
  return field === "file1"
    ? sample.read.fileSize1 == null
    : sample.read.fileSize2 == null;
}

// ── File tree helpers ──

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file: StorageFile | null;
}

function buildFileTree(files: StorageFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), file: null };
  for (const file of files) {
    const parts = file.relativePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: new Map(),
          file: null,
        });
      }
      current = current.children.get(part)!;
    }
    current.file = file;
  }
  return root;
}

interface FileTreeSample {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
}

interface FileTreeNodeProps {
  node: TreeNode;
  depth?: number;
  defaultOpen?: boolean;
  samples: FileTreeSample[];
  fileAssignments: Map<string, { sampleId: string; role: "R1" | "R2" }>;
  onAssociate?: (file: StorageFile, sampleId: string, role: "R1" | "R2") => void;
}

function FileTreeNode({
  node,
  depth = 0,
  defaultOpen = false,
  samples,
  fileAssignments,
  onAssociate,
}: FileTreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isFolder = node.children.size > 0 && !node.file;
  const children = Array.from(node.children.values()).sort((a, b) => {
    const aIsFolder = a.children.size > 0 && !a.file;
    const bIsFolder = b.children.size > 0 && !b.file;
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.name.localeCompare(b.name);
  });

  if (isFolder) {
    const fileCount = countFiles(node);
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 py-1.5 px-1 text-xs hover:bg-secondary/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
          <span className="relative h-3.5 w-3.5 shrink-0">
            <FolderOpen className={cn("absolute inset-0 h-3.5 w-3.5 text-amber-500 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")} />
            <Folder className={cn("absolute inset-0 h-3.5 w-3.5 text-amber-500 transition-opacity duration-200", open ? "opacity-0" : "opacity-100")} />
          </span>
          <span className="truncate font-medium text-foreground">{node.name}</span>
          <span className="text-muted-foreground ml-1 shrink-0">
            ({fileCount})
          </span>
        </button>
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            {children.map((child, i) => (
              <div
                key={child.path}
                className={cn("transition-opacity duration-200", open ? "opacity-100" : "opacity-0")}
                style={{ transitionDelay: open ? `${Math.min(i * 30, 150)}ms` : "0ms" }}
              >
                <FileTreeNode node={child} depth={depth + 1} defaultOpen={depth < 0} samples={samples} fileAssignments={fileAssignments} onAssociate={onAssociate} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Leaf file node
  if (node.file) {
    return (
      <FileTreeLeaf
        node={node}
        depth={depth}
        samples={samples}
        fileAssignments={fileAssignments}
        onAssociate={onAssociate}
      />
    );
  }

  return null;
}

function FileTreeLeaf({
  node,
  depth,
  samples,
  fileAssignments,
  onAssociate,
}: {
  node: TreeNode;
  depth: number;
  samples: FileTreeSample[];
  fileAssignments: Map<string, { sampleId: string; role: "R1" | "R2" }>;
  onAssociate?: (file: StorageFile, sampleId: string, role: "R1" | "R2") => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"R1" | "R2" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Guess R1/R2 from filename
  const isR1 = /_R1[_.]|_1\.f/i.test(node.name);
  const isR2 = /_R2[_.]|_2\.f/i.test(node.name);
  const guessedRole = isR1 ? "R1" : isR2 ? "R2" : null;

  // Current-order assignment from local sample data
  const localAssignment = node.file ? fileAssignments.get(node.file.relativePath) : undefined;
  // Cross-order assignment from API (includes all orders)
  const apiAssignment = node.file?.assignedTo ?? undefined;
  // Is this file assigned to a different order?
  const isOtherOrder = apiAssignment && !localAssignment;

  return (
    <div
      className={cn(
        "group/file flex items-center gap-2 py-1.5 px-1 text-xs rounded transition-colors",
        isOtherOrder ? "opacity-50" : "hover:bg-secondary/30"
      )}
      style={{ paddingLeft: `${depth * 16 + 4}px` }}
    >
      <span className="w-3 shrink-0" />
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono truncate text-foreground">{node.name}</span>
      {guessedRole && (
        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0 text-muted-foreground">
          {guessedRole}
        </Badge>
      )}
      {localAssignment && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200">
          {localAssignment.role} → {localAssignment.sampleId}
        </Badge>
      )}
      {isOtherOrder && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground">
          {apiAssignment.role} → {apiAssignment.sampleId} ({apiAssignment.orderName || "other sequencing order"})
        </Badge>
      )}
      <span className="ml-auto shrink-0 text-muted-foreground">
        {formatFileSize(node.file!.size)}
      </span>
      {onAssociate && (
        <div className="shrink-0">
          <button
            ref={triggerRef}
            onClick={() => {
              if (!menuOpen && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const menuHeight = 240; // generous estimate covering sample list step
                const spaceBelow = window.innerHeight - rect.bottom - 16;
                const top = spaceBelow < menuHeight ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4;
                setMenuPos({ top, left: Math.min(rect.right - 224, rect.left) });
              }
              setMenuOpen(!menuOpen);
              setSelectedRole(null);
            }}
            className="opacity-0 group-hover/file:opacity-100 flex items-center justify-center h-5 w-5 rounded hover:bg-secondary transition-all text-muted-foreground hover:text-foreground"
            title="Associate to sample"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="fixed z-50 w-56 rounded-lg border bg-popover p-1 shadow-md" style={{ top: menuPos.top, left: menuPos.left, maxHeight: `calc(100vh - ${menuPos.top}px - 8px)`, overflowY: 'auto' }}>
                {!selectedRole ? (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Associate as...
                    </div>
                    <button
                      onClick={() => setSelectedRole("R1")}
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary transition-colors"
                    >
                      Read 1 (Forward)
                    </button>
                    <button
                      onClick={() => setSelectedRole("R2")}
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary transition-colors"
                    >
                      Read 2 (Reverse)
                    </button>
                  </>
                ) : (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <button onClick={() => setSelectedRole(null)} className="hover:text-foreground">
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      Assign {selectedRole} to sample
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {samples.map((sample) => (
                        <button
                          key={sample.id}
                          onClick={() => {
                            onAssociate(node.file!, sample.id, selectedRole);
                            setMenuOpen(false);
                            setSelectedRole(null);
                          }}
                          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary transition-colors text-left"
                        >
                          <span className="truncate">{sample.sampleId}</span>
                          {sample.sampleAlias && (
                            <span className="text-muted-foreground truncate">
                              {sample.sampleAlias}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>,
            document.body
          )}
        </div>
      )}
    </div>
  );
}

function countFiles(node: TreeNode): number {
  if (node.file) return 1;
  let count = 0;
  for (const child of node.children.values()) {
    count += countFiles(child);
  }
  return count;
}

export function SequencingDiscoverView({
  orderId,
  samples,
  canManage,
  dataBasePathConfigured,
  onDataChanged,
}: SequencingDiscoverViewProps) {
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<
    SequencingDiscoveryResult[]
  >([]);
  const [scanWarnings, setScanWarnings] =
    useState<SequencingDiscoveryScanWarnings | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(false);
  const [storageFiles, setStorageFiles] = useState<StorageFile[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageSearch, setStorageSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSampleId, setPickerSampleId] = useState<string>("");
  const [pickerRole, setPickerRole] = useState<"R1" | "R2">("R1");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerFiles, setPickerFiles] = useState<StorageFile[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const [defaultReadDataClass, setDefaultReadDataClass] = useState<ReadDataClass>("cleaned");
  const [sampleReadDataClasses, setSampleReadDataClasses] = useState<Record<string, ReadDataClass>>({});

  const getSampleReadDataClass = useCallback(
    (sampleId: string): ReadDataClass =>
      sampleReadDataClasses[sampleId] ?? defaultReadDataClass,
    [defaultReadDataClass, sampleReadDataClasses]
  );

  const setSampleReadDataClass = useCallback((sampleId: string, dataClass: ReadDataClass) => {
    setSampleReadDataClasses((current) => ({
      ...current,
      [sampleId]: dataClass,
    }));
  }, []);

  const refreshStorageFiles = useCallback(() => {
    if (!dataBasePathConfigured) return;
    setStorageLoading(true);
    fetch(`/api/orders/${orderId}/sequencing/browse?limit=500`)
      .then((res) => res.json())
      .then((payload) => {
        setStorageFiles((payload?.files ?? []) as StorageFile[]);
      })
      .catch(() => setStorageFiles([]))
      .finally(() => setStorageLoading(false));
  }, [orderId, dataBasePathConfigured]);

  // Load storage files on mount
  useEffect(() => {
    refreshStorageFiles();
  }, [refreshStorageFiles]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setDiscoveryResults([]);
    setScanWarnings(null);
    try {
      const response = await fetch(
        `/api/orders/${orderId}/sequencing/discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true, autoAssign: false }),
        }
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to discover files");
      }
      setDiscoveryResults(
        (payload.results as SequencingDiscoveryResult[]) ?? []
      );
      setScanWarnings(
        (payload.scanWarnings as SequencingDiscoveryScanWarnings | undefined) ?? null
      );
      setHasDiscovered(true);
      notifyPanel.success(
        `Scanned ${payload.scannedFiles ?? 0} files, found ${payload.summary?.exactMatches ?? 0} exact matches`
      );
    } catch (err) {
      notifyPanel.error(
        err instanceof Error ? err.message : "Failed to discover files"
      );
    } finally {
      setDiscovering(false);
    }
  }, [orderId]);

  const handleApplyMatch = useCallback(
    async (result: SequencingDiscoveryResult) => {
      const sample = samples.find((s) => s.sampleId === result.sampleId);
      if (!sample || !result.suggestion.read1) return;

      setApplyingIds((prev) => new Set(prev).add(sample.id));
      try {
        const response = await fetch(
          `/api/orders/${orderId}/sequencing/reads`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assignments: [
                {
                  sampleId: sample.id,
                  read1: result.suggestion.read1.relativePath,
                  read2: result.suggestion.read2?.relativePath ?? null,
                  dataClass: getSampleReadDataClass(sample.id),
                },
              ],
            }),
          }
        );
        const payload = await response.json();
        const failureMessage = getAssignmentFailureMessage(payload, "Failed to apply match");
        if (!response.ok || failureMessage) {
          throw new Error(failureMessage || "Failed to apply match");
        }
        notifyPanel.success(`Linked reads for ${sample.sampleId}`);
        onDataChanged();
      } catch (err) {
        notifyPanel.error(
          err instanceof Error ? err.message : "Failed to apply match"
        );
      } finally {
        setApplyingIds((prev) => {
          const next = new Set(prev);
          next.delete(sample.id);
          return next;
        });
      }
    },
    [getSampleReadDataClass, orderId, samples, onDataChanged]
  );

  const handleApplyAllExact = useCallback(async () => {
    const exactMatches = discoveryResults.filter(
      (r) => r.suggestion.status === "exact" && r.suggestion.read1
    );
    const assignments = exactMatches
      .map((result) => {
        const sample = samples.find((s) => s.sampleId === result.sampleId);
        if (!sample || !result.suggestion.read1) return null;
        return {
          sampleId: sample.id,
          read1: result.suggestion.read1.relativePath,
          read2: result.suggestion.read2?.relativePath ?? null,
          dataClass: getSampleReadDataClass(sample.id),
        };
      })
      .filter(
        (a): a is { sampleId: string; read1: string; read2: string | null; dataClass: ReadDataClass } =>
          a !== null
      );

    if (assignments.length === 0) {
      notifyPanel.message("No exact matches to apply");
      return;
    }

    try {
      const response = await fetch(
        `/api/orders/${orderId}/sequencing/reads`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments }),
        }
      );
      const payload = await response.json();
      const failureMessage = getAssignmentFailureMessage(payload, "Failed to apply matches");
      if (!response.ok || failureMessage) {
        throw new Error(failureMessage || "Failed to apply matches");
      }
      notifyPanel.success(`Linked reads for ${assignments.length} samples`);
      onDataChanged();
    } catch (err) {
      notifyPanel.error(
        err instanceof Error ? err.message : "Failed to apply matches"
      );
    }
  }, [getSampleReadDataClass, orderId, samples, discoveryResults, onDataChanged]);

  const openPicker = useCallback(
    (sampleId: string, role: "R1" | "R2") => {
      setPickerSampleId(sampleId);
      setPickerRole(role);
      setPickerSearch("");
      setPickerOpen(true);
      setPickerLoading(true);
      fetch(`/api/orders/${orderId}/sequencing/browse?limit=500`)
        .then((res) => res.json())
        .then((payload) =>
          setPickerFiles((payload?.files ?? []) as StorageFile[])
        )
        .catch(() => setPickerFiles([]))
        .finally(() => setPickerLoading(false));
    },
    [orderId]
  );

  const handlePickFile = useCallback(
    async (file: StorageFile) => {
      const sample = samples.find((s) => s.id === pickerSampleId);
      if (!sample) return;

      const existingRead = sample.read;
      const assignment: {
        sampleId: string;
        read1: string | null;
        read2: string | null;
        dataClass: ReadDataClass;
      } = {
        sampleId: sample.id,
        read1: existingRead?.file1 ?? null,
        read2: existingRead?.file2 ?? null,
        dataClass: getSampleReadDataClass(sample.id),
      };

      if (pickerRole === "R1") {
        assignment.read1 = file.relativePath;
      } else {
        assignment.read2 = file.relativePath;
      }

      try {
        const response = await fetch(
          `/api/orders/${orderId}/sequencing/reads`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignments: [assignment] }),
          }
        );
        const payload = await response.json();
        const failureMessage = getAssignmentFailureMessage(payload, "Failed to assign file");
        if (!response.ok || failureMessage) {
          throw new Error(failureMessage || "Failed to assign file");
        }
        notifyPanel.success(
          `Assigned ${pickerRole} for ${sample.sampleId}`
        );
        setPickerOpen(false);
        onDataChanged();
      } catch (err) {
        notifyPanel.error(
          err instanceof Error ? err.message : "Failed to assign file"
        );
      }
    },
    [getSampleReadDataClass, orderId, samples, pickerSampleId, pickerRole, onDataChanged]
  );

  const handleUnlinkRead = useCallback(
    async (sampleDbId: string, role: "R1" | "R2" | "both") => {
      const sample = samples.find((s) => s.id === sampleDbId);
      if (!sample) return;

      const assignment = {
        sampleId: sampleDbId,
        read1: role === "both" || role === "R1" ? null : (sample.read?.file1 ?? null),
        read2: role === "both" || role === "R2" ? null : (sample.read?.file2 ?? null),
        dataClass: sample.read?.dataClass ?? getSampleReadDataClass(sampleDbId),
      };

      try {
        const response = await fetch(
          `/api/orders/${orderId}/sequencing/reads`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignments: [assignment] }),
          }
        );
        const payload = await response.json();
        const failureMessage = getAssignmentFailureMessage(payload, "Failed to unlink read");
        if (!response.ok || failureMessage) {
          throw new Error(failureMessage || "Failed to unlink read");
        }
        notifyPanel.success(`Unlinked ${role === "both" ? "reads" : role} for ${sample.sampleId}`);
        onDataChanged();
      } catch (err) {
        notifyPanel.error(
          err instanceof Error ? err.message : "Failed to unlink read"
        );
      }
    },
    [getSampleReadDataClass, orderId, samples, onDataChanged]
  );

  const handleAssociateFromTree = useCallback(
    async (file: StorageFile, sampleDbId: string, role: "R1" | "R2") => {
      const sample = samples.find((s) => s.id === sampleDbId);
      if (!sample) return;

      const existingRead = sample.read;
      const assignment: { sampleId: string; read1: string | null; read2: string | null; dataClass: ReadDataClass } = {
        sampleId: sampleDbId,
        read1: existingRead?.file1 ?? null,
        read2: existingRead?.file2 ?? null,
        dataClass: getSampleReadDataClass(sampleDbId),
      };

      if (role === "R1") {
        assignment.read1 = file.relativePath;
      } else {
        assignment.read2 = file.relativePath;
      }

      try {
        const response = await fetch(
          `/api/orders/${orderId}/sequencing/reads`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignments: [assignment] }),
          }
        );
        const payload = await response.json();
        const failureMessage = getAssignmentFailureMessage(payload, "Failed to associate file");
        if (!response.ok || failureMessage) {
          throw new Error(failureMessage || "Failed to associate file");
        }
        notifyPanel.success(`Assigned ${role} of ${file.filename} to ${sample.sampleId}`);
        onDataChanged();
      } catch (err) {
        notifyPanel.error(
          err instanceof Error ? err.message : "Failed to associate file"
        );
      }
    },
    [getSampleReadDataClass, orderId, samples, onDataChanged]
  );

  const treeSamples: FileTreeSample[] = useMemo(
    () => samples.map((s) => ({ id: s.id, sampleId: s.sampleId, sampleAlias: s.sampleAlias })),
    [samples]
  );

  // Map file relative paths to which sample+role they're assigned to
  const fileAssignments = useMemo(() => {
    const map = new Map<string, { sampleId: string; role: "R1" | "R2" }>();
    for (const sample of samples) {
      if (sample.read?.file1) {
        map.set(sample.read.file1, { sampleId: sample.sampleId, role: "R1" });
      }
      if (sample.read?.file2) {
        map.set(sample.read.file2, { sampleId: sample.sampleId, role: "R2" });
      }
    }
    return map;
  }, [samples]);

  const filteredStorageFiles = useMemo(() => {
    if (!storageSearch) return storageFiles;
    const q = storageSearch.toLowerCase();
    return storageFiles.filter(
      (f) =>
        f.filename.toLowerCase().includes(q) ||
        f.relativePath.toLowerCase().includes(q)
    );
  }, [storageFiles, storageSearch]);

  const storageTree = useMemo(
    () => buildFileTree(filteredStorageFiles),
    [filteredStorageFiles]
  );

  const filteredPickerFiles = useMemo(() => {
    if (!pickerSearch) return pickerFiles;
    const q = pickerSearch.toLowerCase();
    return pickerFiles.filter(
      (f) =>
        f.filename.toLowerCase().includes(q) ||
        f.relativePath.toLowerCase().includes(q)
    );
  }, [pickerFiles, pickerSearch]);

  const exactCount = discoveryResults.filter(
    (r) => r.suggestion.status === "exact"
  ).length;
  const partialCount = discoveryResults.filter(
    (r) => r.suggestion.status === "partial" || r.suggestion.status === "ambiguous"
  ).length;
  const noMatchCount = discoveryResults.filter(
    (r) => r.suggestion.status === "none"
  ).length;
  const scanWarningCount =
    (scanWarnings?.inaccessibleDirectories.length ?? 0) +
    (scanWarnings?.ignoredEntries ?? 0) +
    (scanWarnings?.activeWritesSkipped ?? 0) +
    (scanWarnings?.truncated ? 1 : 0);

  const pickerSample = samples.find((s) => s.id === pickerSampleId);

  const storageStats = useMemo(() => {
    if (storageFiles.length === 0) return null;
    const totalSize = storageFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    const dates = storageFiles.map((f) => new Date(f.modifiedAt).getTime()).filter(Boolean);
    const newest = dates.length > 0 ? new Date(Math.max(...dates)) : null;
    const oldest = dates.length > 0 ? new Date(Math.min(...dates)) : null;
    const r1Count = storageFiles.filter((f) => /_R1[_.]|_1\.f/.test(f.filename)).length;
    const r2Count = storageFiles.filter((f) => /_R2[_.]|_2\.f/.test(f.filename)).length;
    const pairs = Math.min(r1Count, r2Count);
    return { totalSize, newest, oldest, r1Count, r2Count, pairs };
  }, [storageFiles]);

  const staleReadSamples = useMemo(
    () => samples.filter((sample) => sample.read?.filesMissing),
    [samples]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Discover & Associate</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scan storage for sequencing files and link them to samples
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleDiscover}
            disabled={discovering || !canManage || !dataBasePathConfigured}
          >
            {discovering ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderSearch className="mr-1.5 h-3.5 w-3.5" />
            )}
            Auto-Discover
          </Button>
        </div>
      </div>

      <HelpBox title="What is file association?">
        Association links FASTQ files from sequencing storage to the correct samples in this sequencing order.
        Auto-discover suggests matches from file names, and manual association lets the facility
        assign read files when names are incomplete or ambiguous.
      </HelpBox>

      {staleReadSamples.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-900">
          <div className="font-medium">Linked read paths need review</div>
          <div className="mt-1 text-rose-800">
            {staleReadSamples.length} sample{staleReadSamples.length === 1 ? "" : "s"} currently point
            to missing or inaccessible FASTQ files. Re-associate the files here, or confirm the storage
            path if they were moved.
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">Associate reads as</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Current storage is treated as cleaned by default. Choose raw only for unfiltered sequencer output.
            </div>
          </div>
          <div className="inline-flex rounded-lg border bg-background p-1">
            {READ_DATA_CLASSES.map((dataClass) => (
              <button
                key={dataClass}
                type="button"
                onClick={() => setDefaultReadDataClass(dataClass)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  defaultReadDataClass === dataClass
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {READ_DATA_CLASS_LABELS[dataClass]}
              </button>
            ))}
          </div>
        </div>
        {defaultReadDataClass !== "cleaned" ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">
            Raw or unknown reads may still contain human contamination. Only mark files cleaned after removal has completed.
          </div>
        ) : null}
      </div>

      {!dataBasePathConfigured && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardHeader>
            <CardTitle className="text-base text-amber-900">
              Storage Not Configured
            </CardTitle>
            <CardDescription className="text-amber-800">
              Configure the sequencing storage path in admin settings. The
              sequencer should output files to this location.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {hasDiscovered && scanWarnings && scanWarningCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium">Scan completed with warnings</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-800">
            {scanWarnings.inaccessibleDirectories.length > 0 && (
              <span>
                {scanWarnings.inaccessibleDirectories.length} inaccessible folder
                {scanWarnings.inaccessibleDirectories.length !== 1 ? "s" : ""}
              </span>
            )}
            {scanWarnings.ignoredEntries > 0 && (
              <span>{scanWarnings.ignoredEntries} ignored item{scanWarnings.ignoredEntries !== 1 ? "s" : ""}</span>
            )}
            {scanWarnings.activeWritesSkipped > 0 && (
              <span>
                {scanWarnings.activeWritesSkipped} active write
                {scanWarnings.activeWritesSkipped !== 1 ? "s" : ""} skipped
              </span>
            )}
            {scanWarnings.truncated && (
              <span>
                Results truncated at {scanWarnings.maxFiles?.toLocaleString() ?? "the configured file limit"} files
              </span>
            )}
          </div>
          {scanWarnings.skippedRecentFiles.length > 0 && (
            <div className="mt-2 truncate text-xs text-amber-800">
              Recently modified:{" "}
              {scanWarnings.skippedRecentFiles
                .slice(0, 3)
                .map((file) => file.relativePath)
                .join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Discovery results summary */}
      {hasDiscovered && discoveryResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Discovery Results</CardTitle>
              {exactCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleApplyAllExact}
                  disabled={!canManage}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Apply {exactCount} Exact Match
                  {exactCount !== 1 ? "es" : ""}
                </Button>
              )}
            </div>
            <CardDescription>
              {exactCount} exact, {partialCount} partial, {noMatchCount} no
              match{scanWarningCount > 0 ? `, ${scanWarningCount} scan warning${scanWarningCount !== 1 ? "s" : ""}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {discoveryResults
                .filter((r) => r.suggestion.status !== "none" || r.suggestion.alternatives.length > 0)
                .map((result) => {
                  const sample = samples.find(
                    (s) => s.sampleId === result.sampleId
                  );
                  const barcodeSourceLabel = getBarcodeSourceLabel(
                    result.plannedBarcodeSource
                  );
                  const matchSourceLabel = getMatchSourceLabel(result.suggestion.matchedBy);
                  return (
                    <div
                      key={result.sampleId}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {result.sampleId}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs shrink-0",
                              result.suggestion.status === "exact" &&
                                "bg-emerald-50 text-emerald-700 border-emerald-200",
                              result.suggestion.status === "partial" &&
                                "bg-amber-50 text-amber-700 border-amber-200",
                              result.suggestion.status === "ambiguous" &&
                                "bg-amber-50 text-amber-700 border-amber-200"
                            )}
                          >
                            {result.suggestion.status}
                          </Badge>
                          {result.plannedBarcode ? (
                            <Badge variant="outline" className="font-mono text-[11px]">
                              {result.plannedBarcode}
                            </Badge>
                          ) : null}
                          {sample ? (
                            <Badge
                              variant="outline"
                              className={cn("text-[11px]", getReadDataClassBadgeClassName(getSampleReadDataClass(sample.id)))}
                            >
                              {READ_DATA_CLASS_LABELS[getSampleReadDataClass(sample.id)]}
                            </Badge>
                          ) : null}
                        </div>
                        {(barcodeSourceLabel || matchSourceLabel) && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[barcodeSourceLabel, matchSourceLabel]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                        {sample?.read?.filesMissing ? (
                          <div className="mt-1 text-xs text-rose-700">
                            Existing linked read path is stale; linking this match will
                            replace the active read files.
                          </div>
                        ) : null}
                        {result.suggestion.read1 && (
                          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            <div className="truncate">
                              R1: {result.suggestion.read1.filename}
                            </div>
                            {result.suggestion.read2 && (
                              <div className="truncate">
                                R2: {result.suggestion.read2.filename}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {result.suggestion.read1 && sample && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Select
                            value={getSampleReadDataClass(sample.id)}
                            onValueChange={(value) => setSampleReadDataClass(sample.id, value as ReadDataClass)}
                            disabled={!canManage}
                          >
                            <SelectTrigger className="h-8 w-[130px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {READ_DATA_CLASSES.map((dataClass) => (
                                <SelectItem key={dataClass} value={dataClass}>
                                  {READ_DATA_CLASS_LABELS[dataClass]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleApplyMatch(result)}
                            disabled={
                              !canManage || applyingIds.has(sample.id)
                            }
                          >
                            {applyingIds.has(sample.id) ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Link"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sample-file association table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden border-b border-border bg-secondary/50 px-5 py-2.5 md:block">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-muted-foreground">
            <div className="col-span-3">Sample</div>
            <div className="col-span-2">Planned Barcode</div>
            <div className="col-span-3">Read 1 (Forward)</div>
            <div className="col-span-3">Read 2 (Reverse)</div>
            <div className="col-span-1"></div>
          </div>
        </div>

        <div className="divide-y divide-border">
          {samples.map((sample) => {
            const hasR1 = !!sample.read?.file1;
            const hasR2 = !!sample.read?.file2;
            const barcodeSourceLabel = getBarcodeSourceLabel(sample.plannedBarcodeSource);

            return (
              <div
                key={sample.id}
                className="grid gap-3 px-4 py-3 transition-colors hover:bg-secondary/30 md:grid-cols-12 md:items-center md:gap-4 md:px-5"
              >
                {/* Sample info */}
                <div className="min-w-0 md:col-span-3">
                  <p className="text-sm font-medium truncate">
                    {sample.sampleId}
                  </p>
                  {sample.sampleAlias && (
                    <p className="text-xs text-muted-foreground truncate">
                      {sample.sampleAlias}
                    </p>
                  )}
                </div>

                <div className="min-w-0 md:col-span-2">
                  {sample.plannedBarcode ? (
                    <div className="space-y-1">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {sample.plannedBarcode}
                      </Badge>
                      {barcodeSourceLabel ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {barcodeSourceLabel}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                  <div className="mt-2">
                    <Select
                      value={getSampleReadDataClass(sample.id)}
                      onValueChange={(value) => setSampleReadDataClass(sample.id, value as ReadDataClass)}
                      disabled={!canManage}
                    >
                      <SelectTrigger className="h-8 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {READ_DATA_CLASSES.map((dataClass) => (
                          <SelectItem key={dataClass} value={dataClass}>
                            {READ_DATA_CLASS_LABELS[dataClass]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {sample.read ? (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px]",
                            getReadDataClassBadgeClassName(sample.read.dataClass)
                          )}
                        >
                          Active: {sample.read.dataClassLabel}
                        </Badge>
                        {sample.read.isSimulated ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px]",
                              getReadOriginBadgeClassName(sample.read.readOrigin)
                            )}
                          >
                            {sample.read.readOriginLabel}
                          </Badge>
                        ) : null}
                        {sample.read.filesMissing ? (
                          <Badge
                            variant="outline"
                            className="border-rose-200 bg-rose-50 text-[11px] text-rose-700"
                          >
                            Stale path
                          </Badge>
                        ) : null}
                      </div>
                      {sample.read.filesMissing ? (
                        <div className="mt-1 text-xs text-rose-700">
                          Linked file path is missing or inaccessible.
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {/* R1 */}
                <div className="min-w-0 md:col-span-3">
                  {hasR1 ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 group/r1">
                        <span
                          className={cn(
                            "truncate font-mono text-xs",
                            readFileMissing(sample, "file1")
                              ? "text-rose-700"
                              : "text-foreground"
                          )}
                        >
                          {sample.read!.file1!.split("/").pop()}
                        </span>
                        {canManage && (
                          <button
                            onClick={() =>
                              void handleUnlinkRead(sample.id, "R1")
                            }
                            className="shrink-0 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover/r1:opacity-100"
                            title="Unlink R1"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {readFileMissing(sample, "file1") ? (
                        <div className="text-xs text-rose-700">Missing from storage</div>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      onClick={() => openPicker(sample.id, "R1")}
                      disabled={!canManage}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      <Search className="h-3 w-3" />
                      Select file...
                    </button>
                  )}
                </div>

                {/* R2 */}
                <div className="min-w-0 md:col-span-3">
                  {hasR2 ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 group/r2">
                        <span
                          className={cn(
                            "truncate font-mono text-xs",
                            readFileMissing(sample, "file2")
                              ? "text-rose-700"
                              : "text-foreground"
                          )}
                        >
                          {sample.read!.file2!.split("/").pop()}
                        </span>
                        {canManage && (
                          <button
                            onClick={() =>
                              void handleUnlinkRead(sample.id, "R2")
                            }
                            className="shrink-0 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover/r2:opacity-100"
                            title="Unlink R2"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {readFileMissing(sample, "file2") ? (
                        <div className="text-xs text-rose-700">Missing from storage</div>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      onClick={() => openPicker(sample.id, "R2")}
                      disabled={!canManage || !hasR1}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-1"
                      title={!hasR1 ? "Assign R1 first" : undefined}
                    >
                      <Search className="h-3 w-3" />
                      Select file...
                    </button>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end md:col-span-1">
                  {(hasR1 || hasR2) && canManage && (
                    <button
                      onClick={() =>
                        void handleUnlinkRead(sample.id, "both")
                      }
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      title="Unlink all reads"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Storage files browser */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              Storage Files
            </CardTitle>
            <button
              onClick={refreshStorageFiles}
              disabled={storageLoading}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              title="Rescan storage"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", storageLoading && "animate-spin")} />
              Rescan
            </button>
          </div>
          <CardDescription>
            Files found in the configured sequencing storage location
          </CardDescription>
          {storageStats && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
              <span>{storageFiles.length} file{storageFiles.length !== 1 ? "s" : ""}</span>
              <span>{formatFileSize(storageStats.totalSize)} total</span>
              {storageStats.pairs > 0 && (
                <span>{storageStats.pairs} paired-end sample{storageStats.pairs !== 1 ? "s" : ""}</span>
              )}
              {storageStats.newest && (
                <span>
                  Newest: {storageStats.newest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
              {storageStats.oldest && storageStats.oldest.getTime() !== storageStats.newest!.getTime() && (
                <span>
                  Oldest: {storageStats.oldest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter files..."
                value={storageSearch}
                onChange={(e) => setStorageSearch(e.target.value)}
                className="w-full rounded-lg border bg-secondary/50 py-1.5 pr-3 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>

            {storageLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning storage...
              </div>
            ) : filteredStorageFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {storageSearch
                  ? "No files match your search."
                  : "No sequencing files found in storage."}
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto rounded-lg border p-2">
                {Array.from(storageTree.children.values())
                  .sort((a, b) => {
                    const aIsFolder = a.children.size > 0 && !a.file;
                    const bIsFolder = b.children.size > 0 && !b.file;
                    if (aIsFolder && !bIsFolder) return -1;
                    if (!aIsFolder && bIsFolder) return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((child) => (
                    <FileTreeNode key={child.path} node={child} depth={0} defaultOpen={storageTree.children.size === 1} samples={treeSamples} fileAssignments={fileAssignments} onAssociate={canManage ? handleAssociateFromTree : undefined} />
                  ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* File picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Select {pickerRole} for {pickerSample?.sampleId ?? "sample"}
            </DialogTitle>
            <DialogDescription>
              Choose a FASTQ file from storage to assign as{" "}
              {pickerRole === "R1" ? "forward" : "reverse"} read.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search files..."
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              className="w-full rounded-lg border bg-secondary/50 py-2 pr-3 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>

          <ScrollArea className="max-h-[400px]">
            {pickerLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading files...
              </div>
            ) : filteredPickerFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No files found.
              </div>
            ) : (
              <div className="space-y-1 pr-4">
                {filteredPickerFiles.map((file) => (
                  <button
                    key={file.relativePath}
                    onClick={() => void handlePickFile(file)}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs hover:bg-secondary/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono truncate text-foreground">
                        {file.filename}
                      </div>
                      <div className="text-muted-foreground truncate mt-0.5">
                        {file.relativePath}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                      <span>{formatFileSize(file.size)}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
