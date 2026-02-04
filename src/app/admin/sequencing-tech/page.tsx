"use client";

import { useState, useEffect } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Dna,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useModule, useModules } from "@/lib/modules/ModuleContext";
import {
  FlowCell,
  SequencerDevice,
  SequencingKit,
  SequencingSoftware,
  SequencingTechnology,
  SequencingTechConfig,
} from "@/types/sequencing-technology";

type DeleteTarget =
  | { type: "technology"; item: SequencingTechnology }
  | { type: "device"; item: SequencerDevice }
  | { type: "flowCell"; item: FlowCell }
  | { type: "kit"; item: SequencingKit }
  | { type: "software"; item: SequencingSoftware };

const FLOW_CELL_CATEGORIES: FlowCell["category"][] = [
  "standard",
  "rna",
  "flongle",
  "other",
];

const KIT_CATEGORIES: SequencingKit["category"][] = [
  "ligation",
  "rapid",
  "barcoding",
  "pcr",
  "cdna",
  "direct-rna",
  "amplicon",
  "other",
];

const SOFTWARE_CATEGORIES: SequencingSoftware["category"][] = [
  "control",
  "basecalling",
  "analysis",
  "other",
];

export default function SequencingTechPage() {
  const { enabled: moduleEnabled } = useModule("sequencing-tech");
  const { loading: moduleLoading } = useModules();
  const [config, setConfig] = useState<SequencingTechConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Edit dialog state
  const [editDialog, setEditDialog] = useState(false);
  const [editingTech, setEditingTech] = useState<SequencingTechnology | null>(null);
  const [editForm, setEditForm] = useState<Partial<SequencingTechnology>>({});

  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<SequencerDevice | null>(null);
  const [deviceForm, setDeviceForm] = useState<Partial<SequencerDevice>>({});

  const [flowCellDialogOpen, setFlowCellDialogOpen] = useState(false);
  const [editingFlowCell, setEditingFlowCell] = useState<FlowCell | null>(null);
  const [flowCellForm, setFlowCellForm] = useState<Partial<FlowCell>>({});

  const [kitDialogOpen, setKitDialogOpen] = useState(false);
  const [editingKit, setEditingKit] = useState<SequencingKit | null>(null);
  const [kitForm, setKitForm] = useState<Partial<SequencingKit>>({});

  const [softwareDialogOpen, setSoftwareDialogOpen] = useState(false);
  const [editingSoftware, setEditingSoftware] = useState<SequencingSoftware | null>(null);
  const [softwareForm, setSoftwareForm] = useState<Partial<SequencingSoftware>>({});

  // Expanded cards
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<Set<string>>(new Set());

  // Confirmation dialogs
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Fetch config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/admin/sequencing-tech");
        if (res.ok) {
          const data = await res.json();
          setConfig(data.config);
        }
      } catch {
        console.error("Failed to load config");
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const technologies = config?.technologies ?? [];
  const devices = config?.devices ?? [];
  const flowCells = config?.flowCells ?? [];
  const kits = config?.kits ?? [];
  const software = config?.software ?? [];

  const flowCellById = new Map(flowCells.map((cell) => [cell.id, cell]));
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));
  const softwareById = new Map(software.map((tool) => [tool.id, tool]));

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sequencing-tech", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setConfig(data.config);
      toast.success("Configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetDialogOpen(false);
    setResetting(true);
    try {
      const res = await fetch("/api/admin/sequencing-tech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      const data = await res.json();
      setConfig(data.config);
      toast.success("Reset to defaults");
    } catch {
      toast.error("Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await fetch("/api/admin/sequencing-tech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      });
      if (!res.ok) throw new Error("Failed to check");
      const data = await res.json();

      // Update local config if updates were found and merged
      if (data.hasUpdates && data.config) {
        setConfig(data.config);
        toast.success(data.message);
      } else if (data.error) {
        toast.error(data.message);
      } else {
        toast.info(data.message);
      }
    } catch {
      toast.error("Failed to check for updates");
    } finally {
      setCheckingUpdates(false);
    }
  };

  const getTechnologyById = (id: string) =>
    technologies.find((tech) => tech.id === id);

  const getTechnologyName = (id: string) =>
    getTechnologyById(id)?.name || id;

  const getTechnologyManufacturer = (id: string) =>
    getTechnologyById(id)?.manufacturer || "";

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleDeviceExpanded = (id: string) => {
    setExpandedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAvailable = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      technologies: config.technologies.map((t) =>
        t.id === id ? { ...t, available: !t.available } : t
      ),
    });
  };

  const toggleDeviceAvailable = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      devices: devices.map((device) =>
        device.id === id ? { ...device, available: !device.available } : device
      ),
    });
  };

  const setPlatformDevicesAvailability = (platformId: string, available: boolean) => {
    if (!config) return;
    setConfig({
      ...config,
      devices: devices.map((device) =>
        device.platformId === platformId ? { ...device, available } : device
      ),
    });
  };

  const toggleFlowCellAvailable = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      flowCells: flowCells.map((cell) =>
        cell.id === id ? { ...cell, available: !cell.available } : cell
      ),
    });
  };

  const toggleKitAvailable = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      kits: kits.map((kit) =>
        kit.id === id ? { ...kit, available: !kit.available } : kit
      ),
    });
  };

  const toggleSoftwareAvailable = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      software: software.map((tool) =>
        tool.id === id ? { ...tool, available: !tool.available } : tool
      ),
    });
  };

  const openEditDialog = (tech: SequencingTechnology) => {
    setEditingTech(tech);
    setEditForm({ ...tech });
    setEditDialog(true);
  };

  const handleEditSave = () => {
    if (!config || !editingTech || !editForm.name) return;

    setConfig({
      ...config,
      technologies: config.technologies.map((t) =>
        t.id === editingTech.id
          ? { ...t, ...editForm, localOverrides: true }
          : t
      ),
    });
    setEditDialog(false);
    setEditingTech(null);
    toast.success("Technology updated. Remember to save changes.");
  };

  const openDeleteDialog = (target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!config || !deleteTarget) return;
    switch (deleteTarget.type) {
      case "technology":
        setConfig({
          ...config,
          technologies: technologies.filter((t) => t.id !== deleteTarget.item.id),
        });
        toast.success("Technology removed. Remember to save changes.");
        break;
      case "device":
        setConfig({
          ...config,
          devices: devices.filter((d) => d.id !== deleteTarget.item.id),
        });
        toast.success("Device removed. Remember to save changes.");
        break;
      case "flowCell":
        setConfig({
          ...config,
          flowCells: flowCells.filter((fc) => fc.id !== deleteTarget.item.id),
        });
        toast.success("Flow cell removed. Remember to save changes.");
        break;
      case "kit":
        setConfig({
          ...config,
          kits: kits.filter((kit) => kit.id !== deleteTarget.item.id),
        });
        toast.success("Kit removed. Remember to save changes.");
        break;
      case "software":
        setConfig({
          ...config,
          software: software.filter((tool) => tool.id !== deleteTarget.item.id),
        });
        toast.success("Software removed. Remember to save changes.");
        break;
      default:
        break;
    }
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  };

  const addNewTechnology = () => {
    const newTech: SequencingTechnology = {
      id: `custom-${Date.now()}`,
      name: "New Technology",
      manufacturer: "",
      shortDescription: "Description here",
      specs: [],
      pros: [],
      cons: [],
      bestFor: [],
      available: true,
      order: config?.technologies.length || 0,
    };
    setEditingTech(newTech);
    setEditForm(newTech);
    setEditDialog(true);
  };

  const handleAddNewTech = () => {
    if (!config || !editForm.name) return;

    const newTech: SequencingTechnology = {
      id: editForm.id || `custom-${Date.now()}`,
      name: editForm.name || "New Technology",
      manufacturer: editForm.manufacturer || "",
      shortDescription: editForm.shortDescription || "",
      description: editForm.description,
      specs: editForm.specs || [],
      pros: editForm.pros || [],
      cons: editForm.cons || [],
      bestFor: editForm.bestFor || [],
      available: editForm.available ?? true,
      order: config.technologies.length,
      localOverrides: true,
    };

    setConfig({
      ...config,
      technologies: [...config.technologies, newTech],
    });
    setEditDialog(false);
    setEditingTech(null);
    toast.success("Technology added. Remember to save changes.");
  };

  const openDeviceDialog = (device: SequencerDevice) => {
    setEditingDevice(device);
    setDeviceForm({ ...device });
    setDeviceDialogOpen(true);
  };

  const addNewDevice = () => {
    const defaultPlatformId = technologies[0]?.id || "";
    const newDevice: SequencerDevice = {
      id: `device-${Date.now()}`,
      platformId: defaultPlatformId,
      name: "New Device",
      manufacturer: getTechnologyManufacturer(defaultPlatformId),
      shortDescription: "",
      productOverview: "",
      specs: [],
      compatibleFlowCells: [],
      compatibleKits: [],
      compatibleSoftware: [],
      available: true,
      order: devices.length,
    };
    setEditingDevice(newDevice);
    setDeviceForm(newDevice);
    setDeviceDialogOpen(true);
  };

  const handleDeviceSave = () => {
    if (!config || !deviceForm.id || !deviceForm.name || !deviceForm.platformId) return;

    const normalizedDevice: SequencerDevice = {
      id: deviceForm.id,
      platformId: deviceForm.platformId,
      name: deviceForm.name,
      manufacturer: deviceForm.manufacturer || "",
      sku: deviceForm.sku,
      shortDescription: deviceForm.shortDescription || "",
      productOverview: deviceForm.productOverview || "",
      image: deviceForm.image,
      color: deviceForm.color,
      specs: deviceForm.specs || [],
      connectivity: deviceForm.connectivity,
      features: deviceForm.features || [],
      compatibleFlowCells: deviceForm.compatibleFlowCells || [],
      compatibleKits: deviceForm.compatibleKits || [],
      compatibleSoftware: deviceForm.compatibleSoftware || [],
      available: deviceForm.available ?? true,
      comingSoon: deviceForm.comingSoon,
      order: deviceForm.order ?? devices.length,
      sourceUrl: deviceForm.sourceUrl,
      lastUpdated: deviceForm.lastUpdated,
      localOverrides: true,
    };

    const exists = devices.some((d) => d.id === (editingDevice?.id || deviceForm.id));
    setConfig({
      ...config,
      devices: exists
        ? devices.map((device) =>
            device.id === (editingDevice?.id || deviceForm.id)
              ? normalizedDevice
              : device
          )
        : [...devices, normalizedDevice],
    });
    setDeviceDialogOpen(false);
    setEditingDevice(null);
    toast.success("Device saved. Remember to save changes.");
  };

  const toggleDeviceCompatibility = (
    key: "compatibleFlowCells" | "compatibleKits" | "compatibleSoftware",
    id: string
  ) => {
    const current = (deviceForm[key] || []) as string[];
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    setDeviceForm({ ...deviceForm, [key]: next });
  };

  const openFlowCellDialog = (flowCell: FlowCell) => {
    setEditingFlowCell(flowCell);
    setFlowCellForm({ ...flowCell });
    setFlowCellDialogOpen(true);
  };

  const addNewFlowCell = () => {
    const newFlowCell: FlowCell = {
      id: `flowcell-${Date.now()}`,
      name: "New Flow Cell",
      sku: "",
      category: "standard",
      available: true,
      order: flowCells.length,
    };
    setEditingFlowCell(newFlowCell);
    setFlowCellForm(newFlowCell);
    setFlowCellDialogOpen(true);
  };

  const handleFlowCellSave = () => {
    if (!config || !flowCellForm.id || !flowCellForm.name || !flowCellForm.sku) return;

    const normalizedFlowCell: FlowCell = {
      id: flowCellForm.id,
      name: flowCellForm.name,
      sku: flowCellForm.sku,
      description: flowCellForm.description,
      chemistry: flowCellForm.chemistry,
      poreCount: flowCellForm.poreCount,
      maxOutput: flowCellForm.maxOutput,
      category: flowCellForm.category || "standard",
      image: flowCellForm.image,
      available: flowCellForm.available ?? true,
      order: flowCellForm.order ?? flowCells.length,
      sourceUrl: flowCellForm.sourceUrl,
      localOverrides: true,
    };

    const exists = flowCells.some((cell) => cell.id === (editingFlowCell?.id || flowCellForm.id));
    setConfig({
      ...config,
      flowCells: exists
        ? flowCells.map((cell) =>
            cell.id === (editingFlowCell?.id || flowCellForm.id)
              ? normalizedFlowCell
              : cell
          )
        : [...flowCells, normalizedFlowCell],
    });
    setFlowCellDialogOpen(false);
    setEditingFlowCell(null);
    toast.success("Flow cell saved. Remember to save changes.");
  };

  const openKitDialog = (kit: SequencingKit) => {
    setEditingKit(kit);
    setKitForm({ ...kit });
    setKitDialogOpen(true);
  };

  const addNewKit = () => {
    const newKit: SequencingKit = {
      id: `kit-${Date.now()}`,
      name: "New Kit",
      sku: "",
      category: "ligation",
      inputType: "dna",
      available: true,
      order: kits.length,
    };
    setEditingKit(newKit);
    setKitForm(newKit);
    setKitDialogOpen(true);
  };

  const handleKitSave = () => {
    if (!config || !kitForm.id || !kitForm.name || !kitForm.sku) return;

    const normalizedKit: SequencingKit = {
      id: kitForm.id,
      name: kitForm.name,
      sku: kitForm.sku,
      description: kitForm.description,
      category: kitForm.category || "ligation",
      inputType: kitForm.inputType,
      multiplexing: kitForm.multiplexing,
      barcodeCount: kitForm.barcodeCount,
      image: kitForm.image,
      available: kitForm.available ?? true,
      order: kitForm.order ?? kits.length,
      sourceUrl: kitForm.sourceUrl,
      localOverrides: true,
    };

    const exists = kits.some((existing) => existing.id === (editingKit?.id || kitForm.id));
    setConfig({
      ...config,
      kits: exists
        ? kits.map((existing) =>
            existing.id === (editingKit?.id || kitForm.id)
              ? normalizedKit
              : existing
          )
        : [...kits, normalizedKit],
    });
    setKitDialogOpen(false);
    setEditingKit(null);
    toast.success("Kit saved. Remember to save changes.");
  };

  const openSoftwareDialog = (tool: SequencingSoftware) => {
    setEditingSoftware(tool);
    setSoftwareForm({ ...tool });
    setSoftwareDialogOpen(true);
  };

  const addNewSoftware = () => {
    const newSoftware: SequencingSoftware = {
      id: `software-${Date.now()}`,
      name: "New Software",
      category: "control",
      available: true,
      order: software.length,
    };
    setEditingSoftware(newSoftware);
    setSoftwareForm(newSoftware);
    setSoftwareDialogOpen(true);
  };

  const handleSoftwareSave = () => {
    if (!config || !softwareForm.id || !softwareForm.name) return;

    const normalizedSoftware: SequencingSoftware = {
      id: softwareForm.id,
      name: softwareForm.name,
      description: softwareForm.description,
      category: softwareForm.category || "control",
      version: softwareForm.version,
      downloadUrl: softwareForm.downloadUrl,
      available: softwareForm.available ?? true,
      order: softwareForm.order ?? software.length,
      localOverrides: true,
    };

    const exists = software.some((existing) => existing.id === (editingSoftware?.id || softwareForm.id));
    setConfig({
      ...config,
      software: exists
        ? software.map((existing) =>
            existing.id === (editingSoftware?.id || softwareForm.id)
              ? normalizedSoftware
              : existing
          )
        : [...software, normalizedSoftware],
    });
    setSoftwareDialogOpen(false);
    setEditingSoftware(null);
    toast.success("Software saved. Remember to save changes.");
  };

  const getFlowCellUsage = (id: string) =>
    devices.filter((device) => device.compatibleFlowCells?.includes(id));

  const getKitUsage = (id: string) =>
    devices.filter((device) => device.compatibleKits?.includes(id));

  const getSoftwareUsage = (id: string) =>
    devices.filter((device) => device.compatibleSoftware?.includes(id));

  if (moduleLoading || loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PageContainer>
    );
  }

  if (!moduleEnabled) {
    return (
      <PageContainer>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Dna className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sequencing Technologies</h1>
              <p className="text-muted-foreground">
                Configure available sequencing platforms
              </p>
            </div>
          </div>

          <GlassCard className="p-8">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              <div>
                <h3 className="font-medium">Module Not Enabled</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Enable the "Sequencing Technologies" module in{" "}
                  <a href="/admin/modules" className="text-primary hover:underline">
                    Modules
                  </a>{" "}
                  to configure this feature.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Dna className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sequencing Technologies</h1>
              <p className="text-muted-foreground">
                Configure available sequencing platforms for your facility
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
            >
              {checkingUpdates ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Check for Updates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetDialogOpen(true)}
              disabled={resetting}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reset to Defaults
            </Button>
          </div>
        </div>

        <Tabs defaultValue="platforms" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="platforms">Platforms</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="accessories">Accessories</TabsTrigger>
          </TabsList>

          <TabsContent value="platforms" className="space-y-3 mt-0">
            <div className="space-y-3">
              {technologies.map((tech) => {
                const isExpanded = expandedIds.has(tech.id);
                return (
                  <GlassCard
                    key={tech.id}
                    className={`transition-opacity ${!tech.available ? "opacity-60" : ""}`}
                  >
                    {/* Header Row */}
                    <div className="p-4 flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(tech.id)}
                        className="flex-1 flex items-center gap-4 text-left"
                      >
                        <div
                          className="h-10 w-10 rounded-lg flex items-center justify-center text-lg font-bold"
                          style={{
                            backgroundColor: tech.color
                              ? `${tech.color}20`
                              : "var(--primary-10)",
                            color: tech.color || "var(--primary)",
                          }}
                        >
                          {tech.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{tech.name}</h3>
                            {tech.localOverrides && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                                Modified
                              </span>
                            )}
                            {tech.comingSoon && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                                Coming Soon
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {tech.manufacturer} - {tech.shortDescription}
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor={`avail-${tech.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Available
                          </Label>
                          <Switch
                            id={`avail-${tech.id}`}
                            checked={tech.available}
                            onCheckedChange={() => toggleAvailable(tech.id)}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(tech)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() =>
                            openDeleteDialog({ type: "technology", item: tech })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 border-t border-border/50">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                          {/* Specs */}
                          <div>
                            <h4 className="text-sm font-medium mb-2">Specifications</h4>
                            <div className="space-y-1">
                              {tech.specs.map((spec, i) => (
                                <div
                                  key={i}
                                  className="text-sm flex justify-between"
                                >
                                  <span className="text-muted-foreground">
                                    {spec.label}
                                  </span>
                                  <span>
                                    {spec.value}
                                    {spec.unit && ` ${spec.unit}`}
                                  </span>
                                </div>
                              ))}
                              {tech.specs.length === 0 && (
                                <p className="text-sm text-muted-foreground italic">
                                  No specs defined
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Pros */}
                          <div>
                            <h4 className="text-sm font-medium mb-2 text-green-600">
                              Pros
                            </h4>
                            <ul className="space-y-1">
                              {tech.pros.map((pro, i) => (
                                <li
                                  key={i}
                                  className="text-sm flex items-start gap-2"
                                >
                                  <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                                  <span>{pro.text}</span>
                                </li>
                              ))}
                              {tech.pros.length === 0 && (
                                <p className="text-sm text-muted-foreground italic">
                                  No pros defined
                                </p>
                              )}
                            </ul>
                          </div>

                          {/* Cons */}
                          <div>
                            <h4 className="text-sm font-medium mb-2 text-red-600">
                              Cons
                            </h4>
                            <ul className="space-y-1">
                              {tech.cons.map((con, i) => (
                                <li
                                  key={i}
                                  className="text-sm flex items-start gap-2"
                                >
                                  <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                                  <span>{con.text}</span>
                                </li>
                              ))}
                              {tech.cons.length === 0 && (
                                <p className="text-sm text-muted-foreground italic">
                                  No cons defined
                                </p>
                              )}
                            </ul>
                          </div>
                        </div>

                        {/* Best For */}
                        {tech.bestFor.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-border/50">
                            <h4 className="text-sm font-medium mb-2">Best For</h4>
                            <div className="flex flex-wrap gap-2">
                              {tech.bestFor.map((use, i) => (
                                <span
                                  key={i}
                                  className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary"
                                >
                                  {use}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Price & Turnaround */}
                        <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-6 text-sm">
                          {tech.priceIndicator && (
                            <div>
                              <span className="text-muted-foreground">Cost: </span>
                              <span className="font-medium">{tech.priceIndicator}</span>
                            </div>
                          )}
                          {tech.turnaroundDays && (
                            <div>
                              <span className="text-muted-foreground">
                                Turnaround:{" "}
                              </span>
                              <span className="font-medium">
                                {tech.turnaroundDays.min}-{tech.turnaroundDays.max} days
                              </span>
                            </div>
                          )}
                          {tech.sourceUrl && (
                            <a
                              href={tech.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Documentation
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </GlassCard>
                );
              })}
            </div>

            <Button variant="outline" onClick={addNewTechnology} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Custom Technology
            </Button>
          </TabsContent>

          <TabsContent value="devices" className="space-y-4 mt-0">
            {devices.length === 0 ? (
              <GlassCard className="p-6 text-center text-muted-foreground">
                No devices configured yet. Add a device model to enable model-level selection.
              </GlassCard>
            ) : (
              Object.entries(
                devices.reduce((acc, device) => {
                  const key = device.platformId || "other";
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(device);
                  return acc;
                }, {} as Record<string, SequencerDevice[]>)
              )
                .sort((a, b) => {
                  const orderA = getTechnologyById(a[0])?.order ?? 999;
                  const orderB = getTechnologyById(b[0])?.order ?? 999;
                  return orderA - orderB;
                })
                .map(([platformId, platformDevices]) => {
                  const platformName = getTechnologyName(platformId);
                  const platformManufacturer = getTechnologyManufacturer(platformId);
                  return (
                    <div key={platformId} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-medium">{platformName}</h3>
                          {platformManufacturer && (
                            <p className="text-xs text-muted-foreground">
                              {platformManufacturer}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPlatformDevicesAvailability(platformId, true)}
                          >
                            Enable All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPlatformDevicesAvailability(platformId, false)}
                          >
                            Disable All
                          </Button>
                        </div>
                      </div>

                      {platformDevices
                        .sort((a, b) => a.order - b.order)
                        .map((device) => {
                          const isExpanded = expandedDeviceIds.has(device.id);
                          const compatibleFlowCells = (device.compatibleFlowCells || [])
                            .map((id) => flowCellById.get(id)?.name || id)
                            .filter(Boolean);
                          const compatibleKits = (device.compatibleKits || [])
                            .map((id) => kitById.get(id)?.name || id)
                            .filter(Boolean);
                          const compatibleSoftware = (device.compatibleSoftware || [])
                            .map((id) => softwareById.get(id)?.name || id)
                            .filter(Boolean);

                          return (
                            <GlassCard
                              key={device.id}
                              className={`transition-opacity ${
                                !device.available ? "opacity-60" : ""
                              }`}
                            >
                              <div className="p-4 flex items-center gap-4">
                                <button
                                  type="button"
                                  onClick={() => toggleDeviceExpanded(device.id)}
                                  className="flex-1 flex items-center gap-4 text-left"
                                >
                                  <div
                                    className="h-12 w-12 rounded-lg flex items-center justify-center text-lg font-bold overflow-hidden"
                                    style={{
                                      backgroundColor: device.color
                                        ? `${device.color}20`
                                        : "var(--primary-10)",
                                      color: device.color || "var(--primary)",
                                    }}
                                  >
                                    {device.image ? (
                                      <img
                                        src={device.image}
                                        alt={device.name}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      device.name.charAt(0)
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h3 className="font-semibold">{device.name}</h3>
                                      {device.comingSoon && (
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                                          Coming Soon
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm text-muted-foreground truncate">
                                      {device.shortDescription || "No description"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {platformName}
                                      {device.manufacturer
                                        ? ` · ${device.manufacturer}`
                                        : ""}
                                    </p>
                                  </div>
                                  {isExpanded ? (
                                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                  )}
                                </button>

                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <Label
                                      htmlFor={`avail-device-${device.id}`}
                                      className="text-xs text-muted-foreground"
                                    >
                                      Available
                                    </Label>
                                    <Switch
                                      id={`avail-device-${device.id}`}
                                      checked={device.available}
                                      onCheckedChange={() => toggleDeviceAvailable(device.id)}
                                    />
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openDeviceDialog(device)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() =>
                                      openDeleteDialog({ type: "device", item: device })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="px-4 pb-4 pt-0 border-t border-border/50">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                                    <div>
                                      <h4 className="text-sm font-medium mb-2">
                                        Specifications
                                      </h4>
                                      <div className="space-y-1">
                                        {(device.specs || []).map((spec, i) => (
                                          <div
                                            key={i}
                                            className="text-sm flex justify-between"
                                          >
                                            <span className="text-muted-foreground">
                                              {spec.label}
                                            </span>
                                            <span>
                                              {spec.value}
                                              {spec.unit && ` ${spec.unit}`}
                                            </span>
                                          </div>
                                        ))}
                                        {(device.specs || []).length === 0 && (
                                          <p className="text-sm text-muted-foreground italic">
                                            No specs defined
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <h4 className="text-sm font-medium mb-2">
                                        Features
                                      </h4>
                                      {device.features && device.features.length > 0 ? (
                                        <ul className="space-y-1">
                                          {device.features.map((feature, i) => (
                                            <li key={i} className="text-sm">
                                              {feature}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="text-sm text-muted-foreground italic">
                                          No features listed
                                        </p>
                                      )}
                                    </div>

                                    <div>
                                      <h4 className="text-sm font-medium mb-2">
                                        Compatibility
                                      </h4>
                                      <div className="space-y-2 text-sm">
                                        <div>
                                          <span className="text-muted-foreground">
                                            Flow Cells:
                                          </span>{" "}
                                          {compatibleFlowCells.length > 0
                                            ? compatibleFlowCells.join(", ")
                                            : "None"}
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground">
                                            Kits:
                                          </span>{" "}
                                          {compatibleKits.length > 0
                                            ? compatibleKits.join(", ")
                                            : "None"}
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground">
                                            Software:
                                          </span>{" "}
                                          {compatibleSoftware.length > 0
                                            ? compatibleSoftware.join(", ")
                                            : "None"}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {device.productOverview && (
                                    <div className="mt-4 pt-4 border-t border-border/50 text-sm text-muted-foreground">
                                      {device.productOverview}
                                    </div>
                                  )}

                                  {device.sourceUrl && (
                                    <a
                                      href={device.sourceUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-3 text-sm text-primary hover:underline flex items-center gap-1"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Documentation
                                    </a>
                                  )}
                                </div>
                              )}
                            </GlassCard>
                          );
                        })}
                    </div>
                  );
                })
            )}

            <Button variant="outline" onClick={addNewDevice} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Device
            </Button>
          </TabsContent>

          <TabsContent value="accessories" className="space-y-4 mt-0">
            <Tabs defaultValue="flowCells" className="space-y-4">
              <TabsList>
                <TabsTrigger value="flowCells">Flow Cells</TabsTrigger>
                <TabsTrigger value="kits">Kits</TabsTrigger>
                <TabsTrigger value="software">Software</TabsTrigger>
              </TabsList>

              <TabsContent value="flowCells" className="space-y-3 mt-0">
                {flowCells.length === 0 ? (
                  <GlassCard className="p-6 text-center text-muted-foreground">
                    No flow cells configured yet.
                  </GlassCard>
                ) : (
                  <div className="space-y-2">
                    {flowCells
                      .sort((a, b) => a.order - b.order)
                      .map((cell) => {
                        const usedBy = getFlowCellUsage(cell.id);
                        return (
                          <GlassCard
                            key={cell.id}
                            className={`transition-opacity ${
                              !cell.available ? "opacity-60" : ""
                            }`}
                          >
                            <div className="p-3 grid gap-4 items-center md:grid-cols-[2fr_1fr_2fr_auto]">
                              <div>
                                <div className="font-medium">{cell.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {cell.sku}
                                </div>
                              </div>
                              <div className="text-sm capitalize">{cell.category}</div>
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {usedBy.length > 0
                                  ? usedBy.map((d) => d.name).join(", ")
                                  : "Not linked to any device"}
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Switch
                                  checked={cell.available}
                                  onCheckedChange={() => toggleFlowCellAvailable(cell.id)}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openFlowCellDialog(cell)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() =>
                                    openDeleteDialog({ type: "flowCell", item: cell })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </GlassCard>
                        );
                      })}
                  </div>
                )}

                <Button variant="outline" onClick={addNewFlowCell} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Flow Cell
                </Button>
              </TabsContent>

              <TabsContent value="kits" className="space-y-3 mt-0">
                {kits.length === 0 ? (
                  <GlassCard className="p-6 text-center text-muted-foreground">
                    No kits configured yet.
                  </GlassCard>
                ) : (
                  <div className="space-y-2">
                    {kits
                      .sort((a, b) => a.order - b.order)
                      .map((kit) => {
                        const usedBy = getKitUsage(kit.id);
                        return (
                          <GlassCard
                            key={kit.id}
                            className={`transition-opacity ${
                              !kit.available ? "opacity-60" : ""
                            }`}
                          >
                            <div className="p-3 grid gap-4 items-center md:grid-cols-[2fr_1fr_2fr_auto]">
                              <div>
                                <div className="font-medium">{kit.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {kit.sku}
                                </div>
                              </div>
                              <div className="text-sm capitalize">{kit.category}</div>
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {usedBy.length > 0
                                  ? usedBy.map((d) => d.name).join(", ")
                                  : "Not linked to any device"}
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Switch
                                  checked={kit.available}
                                  onCheckedChange={() => toggleKitAvailable(kit.id)}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openKitDialog(kit)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() =>
                                    openDeleteDialog({ type: "kit", item: kit })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </GlassCard>
                        );
                      })}
                  </div>
                )}

                <Button variant="outline" onClick={addNewKit} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Kit
                </Button>
              </TabsContent>

              <TabsContent value="software" className="space-y-3 mt-0">
                {software.length === 0 ? (
                  <GlassCard className="p-6 text-center text-muted-foreground">
                    No software configured yet.
                  </GlassCard>
                ) : (
                  <div className="space-y-2">
                    {software
                      .sort((a, b) => a.order - b.order)
                      .map((tool) => {
                        const usedBy = getSoftwareUsage(tool.id);
                        return (
                          <GlassCard
                            key={tool.id}
                            className={`transition-opacity ${
                              !tool.available ? "opacity-60" : ""
                            }`}
                          >
                            <div className="p-3 grid gap-4 items-center md:grid-cols-[2fr_1fr_2fr_auto]">
                              <div>
                                <div className="font-medium">{tool.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {tool.version || "Version not set"}
                                </div>
                              </div>
                              <div className="text-sm capitalize">{tool.category}</div>
                              <div className="text-xs text-muted-foreground line-clamp-2">
                                {usedBy.length > 0
                                  ? usedBy.map((d) => d.name).join(", ")
                                  : "Not linked to any device"}
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Switch
                                  checked={tool.available}
                                  onCheckedChange={() => toggleSoftwareAvailable(tool.id)}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openSoftwareDialog(tool)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() =>
                                    openDeleteDialog({ type: "software", item: tool })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </GlassCard>
                        );
                      })}
                  </div>
                )}

                <Button variant="outline" onClick={addNewSoftware} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Software
                </Button>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTech?.id?.startsWith("custom-") && !config?.technologies.find(t => t.id === editingTech?.id)
                ? "Add Technology"
                : "Edit Technology"}
            </DialogTitle>
            <DialogDescription>
              Customize the technology information shown to users
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editForm.name || ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  placeholder="e.g., NovaSeq 6000"
                />
              </div>
              <div className="space-y-2">
                <Label>Manufacturer</Label>
                <Input
                  value={editForm.manufacturer || ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, manufacturer: e.target.value })
                  }
                  placeholder="e.g., Illumina"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Short Description</Label>
              <Input
                value={editForm.shortDescription || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, shortDescription: e.target.value })
                }
                placeholder="Brief description"
              />
            </div>

            <div className="space-y-2">
              <Label>Full Description (optional)</Label>
              <Textarea
                value={editForm.description || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                placeholder="Detailed description"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Brand Color (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={editForm.color || "#3b82f6"}
                    onChange={(e) =>
                      setEditForm({ ...editForm, color: e.target.value })
                    }
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={editForm.color || ""}
                    onChange={(e) =>
                      setEditForm({ ...editForm, color: e.target.value })
                    }
                    placeholder="#0066CC"
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Price Indicator</Label>
                <select
                  value={editForm.priceIndicator || ""}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      priceIndicator: e.target.value as "$" | "$$" | "$$$" | "$$$$" | undefined,
                    })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  <option value="">Not set</option>
                  <option value="$">$ (Low)</option>
                  <option value="$$">$$ (Moderate)</option>
                  <option value="$$$">$$$ (High)</option>
                  <option value="$$$$">$$$$ (Very High)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Specifications (one per line: Label: Value)</Label>
              <Textarea
                value={
                  editForm.specs
                    ?.map((s) => `${s.label}: ${s.value}${s.unit ? ` ${s.unit}` : ""}`)
                    .join("\n") || ""
                }
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  const specs = e.target.value
                    .split("\n")
                    .filter((line: string) => line.includes(":"))
                    .map((line: string) => {
                      const [label, ...rest] = line.split(":");
                      return { label: label.trim(), value: rest.join(":").trim() };
                    });
                  setEditForm({ ...editForm, specs });
                }}
                placeholder="Read Length: 150bp&#10;Output: 6TB"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pros (one per line)</Label>
                <Textarea
                  value={editForm.pros?.map((p) => p.text).join("\n") || ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    const pros = e.target.value
                      .split("\n")
                      .filter((line: string) => line.trim())
                      .map((text: string) => ({ text: text.trim() }));
                    setEditForm({ ...editForm, pros });
                  }}
                  placeholder="High throughput&#10;Low cost per sample"
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Cons (one per line)</Label>
                <Textarea
                  value={editForm.cons?.map((c) => c.text).join("\n") || ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    const cons = e.target.value
                      .split("\n")
                      .filter((line: string) => line.trim())
                      .map((text: string) => ({ text: text.trim() }));
                    setEditForm({ ...editForm, cons });
                  }}
                  placeholder="Short read length&#10;High initial cost"
                  rows={4}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Best For (comma-separated)</Label>
              <Input
                value={editForm.bestFor?.join(", ") || ""}
                onChange={(e) => {
                  const bestFor = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s);
                  setEditForm({ ...editForm, bestFor });
                }}
                placeholder="Whole genome sequencing, RNA-seq, Metagenomics"
              />
            </div>

            <div className="space-y-2">
              <Label>Documentation URL (optional)</Label>
              <Input
                value={editForm.sourceUrl || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, sourceUrl: e.target.value })
                }
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={
                editingTech?.id?.startsWith("custom-") &&
                !config?.technologies.find((t) => t.id === editingTech?.id)
                  ? handleAddNewTech
                  : handleEditSave
              }
            >
              {editingTech?.id?.startsWith("custom-") &&
              !config?.technologies.find((t) => t.id === editingTech?.id)
                ? "Add Technology"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Device Dialog */}
      <Dialog open={deviceDialogOpen} onOpenChange={setDeviceDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDevice?.id?.startsWith("device-") &&
              !devices.find((d) => d.id === editingDevice?.id)
                ? "Add Device"
                : "Edit Device"}
            </DialogTitle>
            <DialogDescription>
              Define a specific device model and its compatible accessories.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Device ID</Label>
                <Input
                  value={deviceForm.id || ""}
                  onChange={(e) =>
                    setDeviceForm({ ...deviceForm, id: e.target.value })
                  }
                  placeholder="ont-minion-mk1d"
                />
              </div>
              <div className="space-y-2">
                <Label>Platform</Label>
                <select
                  value={deviceForm.platformId || ""}
                  onChange={(e) => {
                    const platformId = e.target.value;
                    const manufacturer =
                      deviceForm.manufacturer ||
                      getTechnologyManufacturer(platformId);
                    setDeviceForm({
                      ...deviceForm,
                      platformId,
                      manufacturer,
                    });
                  }}
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  <option value="">Select platform</option>
                  {technologies.map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={deviceForm.name || ""}
                  onChange={(e) =>
                    setDeviceForm({ ...deviceForm, name: e.target.value })
                  }
                  placeholder="MinION Mk1D"
                />
              </div>
              <div className="space-y-2">
                <Label>Manufacturer</Label>
                <Input
                  value={deviceForm.manufacturer || ""}
                  onChange={(e) =>
                    setDeviceForm({ ...deviceForm, manufacturer: e.target.value })
                  }
                  placeholder="Oxford Nanopore"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU (optional)</Label>
                <Input
                  value={deviceForm.sku || ""}
                  onChange={(e) =>
                    setDeviceForm({ ...deviceForm, sku: e.target.value })
                  }
                  placeholder="Device SKU"
                />
              </div>
              <div className="space-y-2">
                <Label>Connectivity</Label>
                <Input
                  value={deviceForm.connectivity || ""}
                  onChange={(e) =>
                    setDeviceForm({ ...deviceForm, connectivity: e.target.value })
                  }
                  placeholder="USB-C"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Short Description</Label>
              <Input
                value={deviceForm.shortDescription || ""}
                onChange={(e) =>
                  setDeviceForm({ ...deviceForm, shortDescription: e.target.value })
                }
                placeholder="Brief description"
              />
            </div>

            <div className="space-y-2">
              <Label>Product Overview</Label>
              <Textarea
                value={deviceForm.productOverview || ""}
                onChange={(e) =>
                  setDeviceForm({ ...deviceForm, productOverview: e.target.value })
                }
                placeholder="Detailed product overview"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Image URL (optional)</Label>
                <Input
                  value={deviceForm.image || ""}
                  onChange={(e) =>
                    setDeviceForm({ ...deviceForm, image: e.target.value })
                  }
                  placeholder="/images/sequencers/devices/ont-minion-mk1d.png"
                />
              </div>
              <div className="space-y-2">
                <Label>Brand Color (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={deviceForm.color || "#3b82f6"}
                    onChange={(e) =>
                      setDeviceForm({ ...deviceForm, color: e.target.value })
                    }
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={deviceForm.color || ""}
                    onChange={(e) =>
                      setDeviceForm({ ...deviceForm, color: e.target.value })
                    }
                    placeholder="#0066CC"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Features (one per line)</Label>
              <Textarea
                value={(deviceForm.features || []).join("\n")}
                onChange={(e) =>
                  setDeviceForm({
                    ...deviceForm,
                    features: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line),
                  })
                }
                placeholder="Improved thermal dissipation"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Specifications (one per line: Label: Value)</Label>
              <Textarea
                value={
                  deviceForm.specs
                    ?.map((s) => `${s.label}: ${s.value}${s.unit ? ` ${s.unit}` : ""}`)
                    .join("\n") || ""
                }
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  const specs = e.target.value
                    .split("\n")
                    .filter((line: string) => line.includes(":"))
                    .map((line: string) => {
                      const [label, ...rest] = line.split(":");
                      return { label: label.trim(), value: rest.join(":").trim() };
                    });
                  setDeviceForm({ ...deviceForm, specs });
                }}
                placeholder="Output: 50 Gb"
                rows={4}
              />
            </div>

            <div className="space-y-3">
              <Label>Compatibility</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Flow Cells
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border border-border/50 p-3">
                    {flowCells.map((cell) => (
                      <label key={cell.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={
                            deviceForm.compatibleFlowCells?.includes(cell.id) || false
                          }
                          onCheckedChange={() =>
                            toggleDeviceCompatibility("compatibleFlowCells", cell.id)
                          }
                        />
                        <span>
                          {cell.name}
                          <span className="text-xs text-muted-foreground">
                            {" "}{cell.sku}
                          </span>
                        </span>
                      </label>
                    ))}
                    {flowCells.length === 0 && (
                      <p className="text-xs text-muted-foreground">No flow cells yet</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Kits
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border border-border/50 p-3">
                    {kits.map((kit) => (
                      <label key={kit.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={deviceForm.compatibleKits?.includes(kit.id) || false}
                          onCheckedChange={() =>
                            toggleDeviceCompatibility("compatibleKits", kit.id)
                          }
                        />
                        <span>
                          {kit.name}
                          <span className="text-xs text-muted-foreground">
                            {" "}{kit.sku}
                          </span>
                        </span>
                      </label>
                    ))}
                    {kits.length === 0 && (
                      <p className="text-xs text-muted-foreground">No kits yet</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Software
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border border-border/50 p-3">
                    {software.map((tool) => (
                      <label key={tool.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={
                            deviceForm.compatibleSoftware?.includes(tool.id) || false
                          }
                          onCheckedChange={() =>
                            toggleDeviceCompatibility("compatibleSoftware", tool.id)
                          }
                        />
                        <span>{tool.name}</span>
                      </label>
                    ))}
                    {software.length === 0 && (
                      <p className="text-xs text-muted-foreground">No software yet</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={deviceForm.order ?? ""}
                  onChange={(e) =>
                    setDeviceForm({
                      ...deviceForm,
                      order: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Available</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={deviceForm.available ?? true}
                    onCheckedChange={(checked) =>
                      setDeviceForm({ ...deviceForm, available: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {deviceForm.available ?? true ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Coming Soon</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={deviceForm.comingSoon ?? false}
                    onCheckedChange={(checked) =>
                      setDeviceForm({ ...deviceForm, comingSoon: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {deviceForm.comingSoon ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Source URL (optional)</Label>
              <Input
                value={deviceForm.sourceUrl || ""}
                onChange={(e) =>
                  setDeviceForm({ ...deviceForm, sourceUrl: e.target.value })
                }
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeviceDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeviceSave}>
              {editingDevice?.id?.startsWith("device-") &&
              !devices.find((d) => d.id === editingDevice?.id)
                ? "Add Device"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flow Cell Dialog */}
      <Dialog open={flowCellDialogOpen} onOpenChange={setFlowCellDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingFlowCell?.id?.startsWith("flowcell-") &&
              !flowCells.find((fc) => fc.id === editingFlowCell?.id)
                ? "Add Flow Cell"
                : "Edit Flow Cell"}
            </DialogTitle>
            <DialogDescription>Configure a flow cell option.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ID</Label>
                <Input
                  value={flowCellForm.id || ""}
                  onChange={(e) =>
                    setFlowCellForm({ ...flowCellForm, id: e.target.value })
                  }
                  placeholder="flo-min114"
                />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={flowCellForm.sku || ""}
                  onChange={(e) =>
                    setFlowCellForm({ ...flowCellForm, sku: e.target.value })
                  }
                  placeholder="FLO-MIN114"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={flowCellForm.name || ""}
                onChange={(e) =>
                  setFlowCellForm({ ...flowCellForm, name: e.target.value })
                }
                placeholder="MinION Flow Cell R10.4.1"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  value={flowCellForm.category || "standard"}
                  onChange={(e) =>
                    setFlowCellForm({
                      ...flowCellForm,
                      category: e.target.value as FlowCell["category"],
                    })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  {FLOW_CELL_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Chemistry</Label>
                <Input
                  value={flowCellForm.chemistry || ""}
                  onChange={(e) =>
                    setFlowCellForm({ ...flowCellForm, chemistry: e.target.value })
                  }
                  placeholder="R10.4.1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pore Count</Label>
                <Input
                  type="number"
                  value={flowCellForm.poreCount ?? ""}
                  onChange={(e) =>
                    setFlowCellForm({
                      ...flowCellForm,
                      poreCount: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="2048"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Output</Label>
                <Input
                  value={flowCellForm.maxOutput || ""}
                  onChange={(e) =>
                    setFlowCellForm({ ...flowCellForm, maxOutput: e.target.value })
                  }
                  placeholder="50 Gb"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={flowCellForm.description || ""}
                onChange={(e) =>
                  setFlowCellForm({ ...flowCellForm, description: e.target.value })
                }
                placeholder="Notes about this flow cell"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Image URL (optional)</Label>
                <Input
                  value={flowCellForm.image || ""}
                  onChange={(e) =>
                    setFlowCellForm({ ...flowCellForm, image: e.target.value })
                  }
                  placeholder="/images/sequencers/flow-cells/flo-min114.png"
                />
              </div>
              <div className="space-y-2">
                <Label>Source URL (optional)</Label>
                <Input
                  value={flowCellForm.sourceUrl || ""}
                  onChange={(e) =>
                    setFlowCellForm({ ...flowCellForm, sourceUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={flowCellForm.order ?? ""}
                  onChange={(e) =>
                    setFlowCellForm({
                      ...flowCellForm,
                      order: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Available</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={flowCellForm.available ?? true}
                    onCheckedChange={(checked) =>
                      setFlowCellForm({ ...flowCellForm, available: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {flowCellForm.available ?? true ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFlowCellDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleFlowCellSave}>
              {editingFlowCell?.id?.startsWith("flowcell-") &&
              !flowCells.find((fc) => fc.id === editingFlowCell?.id)
                ? "Add Flow Cell"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kit Dialog */}
      <Dialog open={kitDialogOpen} onOpenChange={setKitDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingKit?.id?.startsWith("kit-") &&
              !kits.find((k) => k.id === editingKit?.id)
                ? "Add Kit"
                : "Edit Kit"}
            </DialogTitle>
            <DialogDescription>Configure a sequencing kit option.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ID</Label>
                <Input
                  value={kitForm.id || ""}
                  onChange={(e) => setKitForm({ ...kitForm, id: e.target.value })}
                  placeholder="sqk-lsk114"
                />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={kitForm.sku || ""}
                  onChange={(e) => setKitForm({ ...kitForm, sku: e.target.value })}
                  placeholder="SQK-LSK114"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={kitForm.name || ""}
                onChange={(e) => setKitForm({ ...kitForm, name: e.target.value })}
                placeholder="Ligation Sequencing Kit V14"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  value={kitForm.category || "ligation"}
                  onChange={(e) =>
                    setKitForm({
                      ...kitForm,
                      category: e.target.value as SequencingKit["category"],
                    })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  {KIT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Input Type</Label>
                <select
                  value={kitForm.inputType || ""}
                  onChange={(e) =>
                    setKitForm({
                      ...kitForm,
                      inputType: e.target.value as SequencingKit["inputType"],
                    })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  <option value="">Not set</option>
                  <option value="dna">DNA</option>
                  <option value="rna">RNA</option>
                  <option value="both">Both</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Multiplexing</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={kitForm.multiplexing ?? false}
                    onCheckedChange={(checked) =>
                      setKitForm({ ...kitForm, multiplexing: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {kitForm.multiplexing ? "Yes" : "No"}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Barcode Count</Label>
                <Input
                  type="number"
                  value={kitForm.barcodeCount ?? ""}
                  onChange={(e) =>
                    setKitForm({
                      ...kitForm,
                      barcodeCount: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="24"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={kitForm.description || ""}
                onChange={(e) =>
                  setKitForm({ ...kitForm, description: e.target.value })
                }
                placeholder="Notes about this kit"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Image URL (optional)</Label>
                <Input
                  value={kitForm.image || ""}
                  onChange={(e) => setKitForm({ ...kitForm, image: e.target.value })}
                  placeholder="/images/sequencers/kits/sqk-lsk114.png"
                />
              </div>
              <div className="space-y-2">
                <Label>Source URL (optional)</Label>
                <Input
                  value={kitForm.sourceUrl || ""}
                  onChange={(e) =>
                    setKitForm({ ...kitForm, sourceUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={kitForm.order ?? ""}
                  onChange={(e) =>
                    setKitForm({
                      ...kitForm,
                      order: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Available</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={kitForm.available ?? true}
                    onCheckedChange={(checked) =>
                      setKitForm({ ...kitForm, available: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {kitForm.available ?? true ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setKitDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleKitSave}>
              {editingKit?.id?.startsWith("kit-") &&
              !kits.find((k) => k.id === editingKit?.id)
                ? "Add Kit"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Software Dialog */}
      <Dialog open={softwareDialogOpen} onOpenChange={setSoftwareDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSoftware?.id?.startsWith("software-") &&
              !software.find((s) => s.id === editingSoftware?.id)
                ? "Add Software"
                : "Edit Software"}
            </DialogTitle>
            <DialogDescription>Configure a software tool.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ID</Label>
                <Input
                  value={softwareForm.id || ""}
                  onChange={(e) =>
                    setSoftwareForm({ ...softwareForm, id: e.target.value })
                  }
                  placeholder="minknow"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  value={softwareForm.category || "control"}
                  onChange={(e) =>
                    setSoftwareForm({
                      ...softwareForm,
                      category: e.target.value as SequencingSoftware["category"],
                    })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  {SOFTWARE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={softwareForm.name || ""}
                onChange={(e) =>
                  setSoftwareForm({ ...softwareForm, name: e.target.value })
                }
                placeholder="MinKNOW"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={softwareForm.description || ""}
                onChange={(e) =>
                  setSoftwareForm({ ...softwareForm, description: e.target.value })
                }
                placeholder="Device control, basecalling..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Version</Label>
                <Input
                  value={softwareForm.version || ""}
                  onChange={(e) =>
                    setSoftwareForm({ ...softwareForm, version: e.target.value })
                  }
                  placeholder="v24.02"
                />
              </div>
              <div className="space-y-2">
                <Label>Download URL (optional)</Label>
                <Input
                  value={softwareForm.downloadUrl || ""}
                  onChange={(e) =>
                    setSoftwareForm({ ...softwareForm, downloadUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={softwareForm.order ?? ""}
                  onChange={(e) =>
                    setSoftwareForm({
                      ...softwareForm,
                      order: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Available</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={softwareForm.available ?? true}
                    onCheckedChange={(checked) =>
                      setSoftwareForm({ ...softwareForm, available: checked })
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {softwareForm.available ?? true ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSoftwareDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSoftwareSave}>
              {editingSoftware?.id?.startsWith("software-") &&
              !software.find((s) => s.id === editingSoftware?.id)
                ? "Add Software"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to Defaults</DialogTitle>
            <DialogDescription>
              This will reset all technologies, devices, and accessories to the default configuration. Your customizations will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove{" "}
              {deleteTarget?.type === "flowCell"
                ? "Flow Cell"
                : deleteTarget?.type === "kit"
                ? "Kit"
                : deleteTarget?.type === "software"
                ? "Software"
                : deleteTarget?.type === "device"
                ? "Device"
                : "Technology"}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove &quot;{deleteTarget?.item.name}&quot;? You can restore it by resetting to defaults.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
