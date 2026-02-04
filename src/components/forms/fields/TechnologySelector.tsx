"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FlowCell,
  SequencerDevice,
  SequencingKit,
  SequencingSoftware,
  SequencingTechnology,
  SequencingTechSelection,
} from "@/types/sequencing-technology";

interface TechnologySelectorProps {
  value?: SequencingTechSelection | string;
  onChange: (value: SequencingTechSelection | undefined) => void;
  disabled?: boolean;
}

interface TechResponse {
  technologies: SequencingTechnology[];
  devices: SequencerDevice[];
  flowCells: FlowCell[];
  kits: SequencingKit[];
  software: SequencingSoftware[];
}

export function TechnologySelector({
  value,
  onChange,
  disabled,
}: TechnologySelectorProps) {
  const [technologies, setTechnologies] = useState<SequencingTechnology[]>([]);
  const [devices, setDevices] = useState<SequencerDevice[]>([]);
  const [flowCells, setFlowCells] = useState<FlowCell[]>([]);
  const [kits, setKits] = useState<SequencingKit[]>([]);
  const [software, setSoftware] = useState<SequencingSoftware[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selection = useMemo<SequencingTechSelection | undefined>(() => {
    if (!value) return undefined;
    if (typeof value === "string") {
      return { technologyId: value };
    }
    return value;
  }, [value]);

  useEffect(() => {
    const fetchTechnologies = async () => {
      try {
        const res = await fetch("/api/sequencing-tech");
        if (res.ok) {
          const data = (await res.json()) as TechResponse;
          setTechnologies(data.technologies || []);
          setDevices(data.devices || []);
          setFlowCells(data.flowCells || []);
          setKits(data.kits || []);
          setSoftware(data.software || []);
        }
      } catch {
        console.error("Failed to load technologies");
      } finally {
        setLoading(false);
      }
    };
    fetchTechnologies();
  }, []);

  const selectedTechnologyId = selection?.technologyId;
  const selectedDeviceId = selection?.deviceId;
  const selectedFlowCellId = selection?.flowCellId;
  const selectedKitId = selection?.kitId;

  const availableDevices = selectedTechnologyId
    ? devices.filter((device) => device.platformId === selectedTechnologyId)
    : [];
  const selectedDevice = selectedDeviceId
    ? availableDevices.find((device) => device.id === selectedDeviceId)
    : undefined;

  const compatibleFlowCells = selectedDevice
    ? flowCells.filter((cell) =>
        (selectedDevice.compatibleFlowCells || []).includes(cell.id)
      )
    : [];
  const compatibleKits = selectedDevice
    ? kits.filter((kit) =>
        (selectedDevice.compatibleKits || []).includes(kit.id)
      )
    : [];
  const compatibleSoftware = selectedDevice
    ? software.filter((tool) =>
        (selectedDevice.compatibleSoftware || []).includes(tool.id)
      )
    : [];

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  const updateSelection = useCallback(
    (next: SequencingTechSelection | undefined) => {
      if (disabled) return;
      onChange(next);
    },
    [disabled, onChange]
  );

  const selectTechnology = useCallback(
    (tech: SequencingTechnology) => {
      if (disabled) return;
      if (selection?.technologyId === tech.id) {
        updateSelection(undefined);
        return;
      }
      updateSelection({
        ...selection,
        technologyId: tech.id,
        technologyName: tech.name,
        deviceId: undefined,
        deviceName: undefined,
        flowCellId: undefined,
        flowCellSku: undefined,
        kitId: undefined,
        kitSku: undefined,
        softwareIds: undefined,
      });
    },
    [disabled, selection, updateSelection]
  );

  const selectDevice = useCallback(
    (device: SequencerDevice, allowToggle = true) => {
      if (disabled) return;
      if (allowToggle && selection?.deviceId === device.id) {
        updateSelection({
          ...selection,
          deviceId: undefined,
          deviceName: undefined,
          flowCellId: undefined,
          flowCellSku: undefined,
          kitId: undefined,
          kitSku: undefined,
          softwareIds: undefined,
        });
        return;
      }
      updateSelection({
        ...selection,
        technologyId: selection?.technologyId ?? device.platformId,
        deviceId: device.id,
        deviceName: device.name,
        flowCellId: undefined,
        flowCellSku: undefined,
        kitId: undefined,
        kitSku: undefined,
        softwareIds: device.compatibleSoftware || [],
      });
    },
    [disabled, selection, updateSelection]
  );

  const selectFlowCell = useCallback(
    (cell: FlowCell, allowToggle = true) => {
      if (disabled) return;
      const resolvedTechnologyId = selection?.technologyId ?? selectedDevice?.platformId;
      if (!resolvedTechnologyId) return;
      if (allowToggle && selection?.flowCellId === cell.id) {
        updateSelection({
          ...selection,
          flowCellId: undefined,
          flowCellSku: undefined,
          kitId: undefined,
          kitSku: undefined,
        });
        return;
      }
      updateSelection({
        ...selection,
        technologyId: resolvedTechnologyId,
        flowCellId: cell.id,
        flowCellSku: cell.sku,
      });
    },
    [disabled, selection, selectedDevice, updateSelection]
  );

  const selectKit = useCallback(
    (kit: SequencingKit, allowToggle = true) => {
      if (disabled) return;
      const resolvedTechnologyId = selection?.technologyId ?? selectedDevice?.platformId;
      if (!resolvedTechnologyId) return;
      if (allowToggle && selection?.kitId === kit.id) {
        updateSelection({
          ...selection,
          kitId: undefined,
          kitSku: undefined,
        });
        return;
      }
      updateSelection({
        ...selection,
        technologyId: resolvedTechnologyId,
        kitId: kit.id,
        kitSku: kit.sku,
      });
    },
    [disabled, selection, selectedDevice, updateSelection]
  );

  const autoDevice = availableDevices.length === 1 ? availableDevices[0] : null;
  const autoFlowCell = compatibleFlowCells.length === 1 ? compatibleFlowCells[0] : null;
  const autoKit = compatibleKits.length === 1 ? compatibleKits[0] : null;

  useEffect(() => {
    if (!selectedTechnologyId || !autoDevice || selection?.deviceId) return;
    selectDevice(autoDevice, false);
  }, [autoDevice, selectDevice, selectedTechnologyId, selection?.deviceId]);

  useEffect(() => {
    if (!selectedDevice || !autoFlowCell || selection?.flowCellId) return;
    selectFlowCell(autoFlowCell, false);
  }, [autoFlowCell, selectFlowCell, selectedDevice, selection?.flowCellId]);

  useEffect(() => {
    if (!selectedDevice || !autoKit || selection?.kitId) return;
    selectKit(autoKit, false);
  }, [autoKit, selectKit, selectedDevice, selection?.kitId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (technologies.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No sequencing technologies configured
      </div>
    );
  }

  const showDeviceStep = devices.length > 0;
  const visibleTechnologies = showDeviceStep
    ? technologies.filter((tech) =>
        devices.some((device) => device.platformId === tech.id)
      )
    : technologies;

  const byManufacturer = visibleTechnologies.reduce((acc, tech) => {
    const key = tech.manufacturer || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(tech);
    return acc;
  }, {} as Record<string, SequencingTechnology[]>);

  const StepHeader = ({
    step,
    title,
    description,
  }: {
    step: number;
    title: string;
    description?: string;
  }) => (
    <div className="flex items-center gap-3">
      <div className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
        {step}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );

  if (visibleTechnologies.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No sequencing technologies with configured devices
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <StepHeader
          step={1}
          title="Select Platform"
          description="Choose the sequencing technology family"
        />

        {Object.entries(byManufacturer).map(([manufacturer, techs]) => (
          <div key={manufacturer} className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {manufacturer}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {techs.map((tech) => {
                const isSelected = selection?.technologyId === tech.id;
                const isExpanded = expandedId === tech.id;

                return (
                  <GlassCard
                    key={tech.id}
                    className={cn(
                      "cursor-pointer transition-all",
                      isSelected
                        ? "ring-2 ring-primary bg-primary/5"
                        : "hover:bg-muted/50",
                      disabled && "opacity-50 cursor-not-allowed"
                    )}
                    onClick={() => selectTechnology(tech)}
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className="h-10 w-10 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0"
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
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold">{tech.name}</h4>
                            {isSelected && (
                              <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {tech.shortDescription}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        {tech.priceIndicator && (
                          <span>Cost: {tech.priceIndicator}</span>
                        )}
                        {tech.turnaroundDays && (
                          <span>
                            {tech.turnaroundDays.min}-{tech.turnaroundDays.max} days
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => toggleExpanded(tech.id, e)}
                          className="ml-auto flex items-center gap-1 text-primary hover:underline"
                        >
                          <Info className="h-3 w-3" />
                          Details
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div
                        className="px-4 pb-4 border-t border-border/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-2 gap-4 pt-4">
                          {tech.specs.length > 0 && (
                            <div>
                              <h5 className="text-xs font-medium text-muted-foreground mb-2">
                                Specifications
                              </h5>
                              <div className="space-y-1">
                                {tech.specs.slice(0, 4).map((spec, i) => (
                                  <div
                                    key={i}
                                    className="text-xs flex justify-between"
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
                              </div>
                            </div>
                          )}

                          <div className="space-y-2">
                            {tech.pros.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium text-green-600 mb-1">
                                  Pros
                                </h5>
                                <ul className="space-y-0.5">
                                  {tech.pros.slice(0, 3).map((pro, i) => (
                                    <li
                                      key={i}
                                      className="text-xs flex items-start gap-1"
                                    >
                                      <Check className="h-3 w-3 text-green-600 flex-shrink-0 mt-0.5" />
                                      <span className="line-clamp-1">
                                        {pro.text}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {tech.cons.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium text-red-600 mb-1">
                                  Cons
                                </h5>
                                <ul className="space-y-0.5">
                                  {tech.cons.slice(0, 2).map((con, i) => (
                                    <li
                                      key={i}
                                      className="text-xs flex items-start gap-1"
                                    >
                                      <X className="h-3 w-3 text-red-600 flex-shrink-0 mt-0.5" />
                                      <span className="line-clamp-1">
                                        {con.text}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>

                        {tech.bestFor.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <h5 className="text-xs font-medium text-muted-foreground mb-1">
                              Best For
                            </h5>
                            <div className="flex flex-wrap gap-1">
                              {tech.bestFor.map((use, i) => (
                                <span
                                  key={i}
                                  className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                                >
                                  {use}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {tech.sourceUrl && (
                          <a
                            href={tech.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Learn more
                          </a>
                        )}
                      </div>
                    )}
                  </GlassCard>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {showDeviceStep && (
        <div className="space-y-3">
          <StepHeader
            step={2}
            title="Select Device"
            description={
              selectedTechnologyId
                ? "Choose the specific device model"
                : "Select a platform to see available devices"
            }
          />

          {!selectedTechnologyId ? (
            <GlassCard className="p-4 text-sm text-muted-foreground">
              Select a platform to continue.
            </GlassCard>
          ) : availableDevices.length === 0 ? (
            <GlassCard className="p-4 text-sm text-muted-foreground">
              No devices configured for this platform.
            </GlassCard>
          ) : autoDevice && availableDevices.length === 1 ? (
            <GlassCard className="p-4">
              <p className="text-xs text-muted-foreground">Auto-selected</p>
              <p className="font-medium">{autoDevice.name}</p>
              {autoDevice.shortDescription && (
                <p className="text-sm text-muted-foreground">
                  {autoDevice.shortDescription}
                </p>
              )}
            </GlassCard>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {availableDevices.map((device) => {
                const isSelected = selection?.deviceId === device.id;
                return (
                  <GlassCard
                    key={device.id}
                    className={cn(
                      "cursor-pointer transition-all",
                      isSelected
                        ? "ring-2 ring-primary bg-primary/5"
                        : "hover:bg-muted/50",
                      disabled && "opacity-50 cursor-not-allowed"
                    )}
                    onClick={() => selectDevice(device)}
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className="h-10 w-10 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0 overflow-hidden"
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
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold">{device.name}</h4>
                            {isSelected && (
                              <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {device.shortDescription || "No description"}
                          </p>
                          {device.connectivity && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Connectivity: {device.connectivity}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showDeviceStep && selectedDevice && (
        <div className="space-y-3">
          <StepHeader
            step={3}
            title="Select Flow Cell"
            description="Choose a compatible flow cell"
          />

          {compatibleFlowCells.length === 0 ? (
            <GlassCard className="p-4 text-sm text-muted-foreground">
              No flow cells configured for this device.
            </GlassCard>
          ) : autoFlowCell && compatibleFlowCells.length === 1 ? (
            <GlassCard className="p-4">
              <p className="text-xs text-muted-foreground">Auto-selected</p>
              <p className="font-medium">{autoFlowCell.name}</p>
              <p className="text-sm text-muted-foreground">{autoFlowCell.sku}</p>
            </GlassCard>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {compatibleFlowCells.map((cell) => {
                const isSelected = selectedFlowCellId === cell.id;
                return (
                  <GlassCard
                    key={cell.id}
                    className={cn(
                      "cursor-pointer transition-all",
                      isSelected
                        ? "ring-2 ring-primary bg-primary/5"
                        : "hover:bg-muted/50",
                      disabled && "opacity-50 cursor-not-allowed"
                    )}
                    onClick={() => selectFlowCell(cell)}
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
                          {cell.category.toUpperCase().slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold">{cell.name}</h4>
                            {isSelected && (
                              <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {cell.sku}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-2">
                            {cell.chemistry && <span>Chemistry: {cell.chemistry}</span>}
                            {cell.poreCount && <span>Pores: {cell.poreCount}</span>}
                            {cell.maxOutput && <span>Max Output: {cell.maxOutput}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showDeviceStep && selectedDevice && (
        <div className="space-y-3">
          <StepHeader
            step={4}
            title="Select Kit"
            description="Pick a sequencing kit compatible with this device"
          />

          {compatibleKits.length === 0 ? (
            <GlassCard className="p-4 text-sm text-muted-foreground">
              No kits configured for this device.
            </GlassCard>
          ) : autoKit && compatibleKits.length === 1 ? (
            <GlassCard className="p-4">
              <p className="text-xs text-muted-foreground">Auto-selected</p>
              <p className="font-medium">{autoKit.name}</p>
              <p className="text-sm text-muted-foreground">{autoKit.sku}</p>
            </GlassCard>
          ) : (
            <div className="space-y-4">
              {Object.entries(
                compatibleKits.reduce((acc, kit) => {
                  const key = kit.category;
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(kit);
                  return acc;
                }, {} as Record<string, SequencingKit[]>)
              ).map(([category, categoryKits]) => (
                <div key={category} className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {category}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {categoryKits.map((kit) => {
                      const isSelected = selectedKitId === kit.id;
                      return (
                        <GlassCard
                          key={kit.id}
                          className={cn(
                            "cursor-pointer transition-all",
                            isSelected
                              ? "ring-2 ring-primary bg-primary/5"
                              : "hover:bg-muted/50",
                            disabled && "opacity-50 cursor-not-allowed"
                          )}
                          onClick={() => selectKit(kit)}
                        >
                          <div className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
                                {kit.category.toUpperCase().slice(0, 2)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-semibold">{kit.name}</h4>
                                  {isSelected && (
                                    <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                      <Check className="h-3 w-3 text-primary-foreground" />
                                    </div>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {kit.sku}
                                </p>
                                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-2">
                                  {kit.inputType && (
                                    <span>Input: {kit.inputType.toUpperCase()}</span>
                                  )}
                                  {kit.multiplexing && kit.barcodeCount && (
                                    <span>Barcodes: {kit.barcodeCount}</span>
                                  )}
                                  {kit.multiplexing && !kit.barcodeCount && (
                                    <span>Multiplexing</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </GlassCard>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showDeviceStep && selectedDevice && compatibleSoftware.length > 0 && (
        <GlassCard className="p-4 bg-muted/30">
          <StepHeader
            step={5}
            title="Software"
            description="These tools are used for control and analysis"
          />
          <div className="mt-3 space-y-2">
            {compatibleSoftware.map((tool) => (
              <div key={tool.id} className="text-sm">
                <p className="font-medium">{tool.name}</p>
                {tool.description && (
                  <p className="text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
