"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The little pictures on the tiles: a sketch of what the element will look like. */
export type SketchKind = "text" | "histogram" | "bar" | "scatter" | "box" | "numbers" | "table" | "figure" | "samples" | "sequencing" | "pipeline" | "import" | "analysis";

export interface StoreItem {
  id: string;
  title: string;
  /** A few words under the title; keep it short, the sketch does the talking. */
  hint?: string;
  sketch?: SketchKind;
  /** A real thumbnail instead of a sketch, for figures that exist already. */
  image?: string | null;
  /** Shown in the corner, for example "added" or "output". */
  badge?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface StoreGroup {
  label: string;
  items: StoreItem[];
  /** Shown when the group has no items. */
  empty?: string;
}

interface ElementStoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  groups: StoreGroup[];
}

/**
 * A picker that shows what you get: tiles with a sketch, a name and a hint,
 * grouped by where the element comes from. Used to add tables and analyses to
 * the canvas and blocks to the report.
 */
export function ElementStore({ open, onOpenChange, title, description, groups }: ElementStoreProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
              {group.items.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{group.empty ?? "Nothing here yet."}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => {
                        item.onSelect();
                        onOpenChange(false);
                      }}
                      className={cn(
                        "group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors",
                        item.disabled ? "opacity-50" : "hover:border-foreground/40 hover:bg-muted/40 focus-visible:border-foreground/60"
                      )}
                      title={item.hint}
                    >
                      <div className="flex h-20 w-full items-center justify-center overflow-hidden bg-muted/50">
                        {item.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Sketch kind={item.sketch ?? "table"} />
                        )}
                      </div>
                      {item.badge && <span className="absolute right-1.5 top-1.5 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">{item.badge}</span>}
                      <div className="min-w-0 px-2.5 py-2">
                        <div className="truncate text-sm font-medium">{item.title}</div>
                        {item.hint && <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{item.hint}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const stroke = "currentColor";

/** Tiny decorative drawings; the accent colour follows the text colour of the tile. */
function Sketch({ kind }: { kind: SketchKind }): ReactNode {
  const common = { className: "h-14 w-24 text-foreground/70 transition-colors group-hover:text-foreground", viewBox: "0 0 96 56", "aria-hidden": true } as const;
  switch (kind) {
    case "text":
      return (
        <svg {...common}>
          <rect x="10" y="10" width="48" height="5" rx="2" fill={stroke} />
          <rect x="10" y="22" width="76" height="3" rx="1.5" fill={stroke} opacity="0.5" />
          <rect x="10" y="30" width="70" height="3" rx="1.5" fill={stroke} opacity="0.5" />
          <rect x="10" y="38" width="60" height="3" rx="1.5" fill={stroke} opacity="0.5" />
        </svg>
      );
    case "histogram":
      return (
        <svg {...common}>
          {[8, 20, 34, 44, 30, 18, 10].map((h, i) => (
            <rect key={i} x={12 + i * 11} y={50 - h} width="9" height={h} rx="1" fill={stroke} opacity={0.35 + (i % 3) * 0.2} />
          ))}
          <path d="M8 50h82" stroke={stroke} strokeWidth="1" opacity="0.5" />
        </svg>
      );
    case "bar":
      return (
        <svg {...common}>
          {[40, 26, 18, 10].map((h, i) => (
            <rect key={i} x={14 + i * 20} y={50 - h} width="14" height={h} rx="1.5" fill={stroke} opacity={0.9 - i * 0.18} />
          ))}
          <path d="M8 50h82" stroke={stroke} strokeWidth="1" opacity="0.5" />
        </svg>
      );
    case "scatter":
      return (
        <svg {...common}>
          {[[14, 42], [22, 36], [30, 38], [36, 28], [44, 30], [50, 22], [58, 24], [64, 16], [72, 18], [80, 10]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3" fill={stroke} opacity={0.5 + (i % 2) * 0.35} />
          ))}
          <path d="M8 50h82M8 50V6" stroke={stroke} strokeWidth="1" opacity="0.5" />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          {[[20, 14, 30], [48, 20, 24], [76, 10, 34]].map(([x, top, h], i) => (
            <g key={i} stroke={stroke} strokeWidth="1.5" fill="none" opacity="0.8">
              <path d={`M${x} ${top - 6}v${h + 12}`} />
              <rect x={x - 9} y={top} width="18" height={h} fill="currentColor" fillOpacity="0.15" />
              <path d={`M${x - 9} ${top + h / 2}h18`} />
            </g>
          ))}
        </svg>
      );
    case "numbers":
      return (
        <svg {...common}>
          <text x="48" y="34" textAnchor="middle" fontSize="24" fontWeight="600" fill={stroke}>128</text>
          <rect x="30" y="41" width="36" height="3" rx="1.5" fill={stroke} opacity="0.4" />
        </svg>
      );
    case "table":
    case "samples":
    case "sequencing":
    case "pipeline":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="80" height="40" rx="3" stroke={stroke} strokeWidth="1.5" fill="none" />
          <path d="M8 19h80M8 30h80M8 40h80M34 8v40M62 8v40" stroke={stroke} strokeWidth="1" opacity="0.5" />
          {kind === "samples" && <circle cx="21" cy="13.5" r="2.5" fill={stroke} />}
          {kind === "sequencing" && <path d="M12 13.5h18" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />}
          {kind === "pipeline" && <path d="M14 13.5h6l3-3 3 3h6" stroke={stroke} strokeWidth="1.5" fill="none" />}
        </svg>
      );
    case "figure":
      return (
        <svg {...common}>
          <rect x="8" y="6" width="80" height="44" rx="3" stroke={stroke} strokeWidth="1.5" fill="none" />
          <path d="M14 42c10-2 14-22 24-22s12 14 20 14 10-16 22-18" stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "import":
      return (
        <svg {...common}>
          <path d="M48 8v26M38 24l10 10 10-10" stroke={stroke} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 40v6a2 2 0 0 0 2 2h64a2 2 0 0 0 2-2v-6" stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "analysis":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="80" height="40" rx="3" stroke={stroke} strokeWidth="1.5" fill="none" />
          <path d="M18 20h22M18 28h34M18 36h16" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
          <path d="M66 24l6 6-6 6" stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
