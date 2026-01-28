"use client";

import { useState, useEffect } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SequencingTechnology } from "@/types/sequencing-technology";

interface TechnologySelectorProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

export function TechnologySelector({
  value,
  onChange,
  disabled,
}: TechnologySelectorProps) {
  const [technologies, setTechnologies] = useState<SequencingTechnology[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTechnologies = async () => {
      try {
        const res = await fetch("/api/sequencing-tech");
        if (res.ok) {
          const data = await res.json();
          setTechnologies(data.technologies || []);
        }
      } catch {
        console.error("Failed to load technologies");
      } finally {
        setLoading(false);
      }
    };
    fetchTechnologies();
  }, []);

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  };

  const handleSelect = (id: string) => {
    if (disabled) return;
    onChange(value === id ? undefined : id);
  };

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

  // Group by manufacturer
  const byManufacturer = technologies.reduce((acc, tech) => {
    const key = tech.manufacturer || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(tech);
    return acc;
  }, {} as Record<string, SequencingTechnology[]>);

  return (
    <div className="space-y-6">
      {Object.entries(byManufacturer).map(([manufacturer, techs]) => (
        <div key={manufacturer} className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {manufacturer}
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {techs.map((tech) => {
              const isSelected = value === tech.id;
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
                  onClick={() => handleSelect(tech.id)}
                >
                  {/* Header */}
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

                    {/* Quick Info Row */}
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                      {tech.priceIndicator && (
                        <span>Cost: {tech.priceIndicator}</span>
                      )}
                      {tech.turnaroundDays && (
                        <span>
                          {tech.turnaroundDays.min}-{tech.turnaroundDays.max}{" "}
                          days
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

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div
                      className="px-4 pb-4 border-t border-border/50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="grid grid-cols-2 gap-4 pt-4">
                        {/* Specs */}
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

                        {/* Pros & Cons */}
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

                      {/* Best For */}
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
  );
}
