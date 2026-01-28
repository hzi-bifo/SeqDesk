"use client";

import { GlassCard } from "@/components/ui/glass-card";
import { Dna, Settings, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Admin editor component for Sequencing Technology field type.
 * Shown in Form Builder when editing a sequencing-tech field.
 */
export function SequencingTechAdminEditor() {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Dna className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium">Sequencing Technology Selector</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Users will see a card-based selector with technology information
            including specifications, pros/cons, and best-use cases.
          </p>

          <div className="mt-4 p-3 rounded-lg bg-muted/50 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Settings className="h-4 w-4" />
              Technology Configuration
            </div>
            <p className="text-muted-foreground mt-1 mb-3">
              Configure available technologies, their specs, and pricing in the
              dedicated settings page.
            </p>
            <Link
              href="/admin/sequencing-tech"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ArrowRight className="h-3 w-3" />
              Configure Technologies
            </Link>
          </div>

          <div className="mt-4 text-xs text-muted-foreground">
            <strong>What users see:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>Technology cards grouped by manufacturer</li>
              <li>Quick info: cost indicator, turnaround time</li>
              <li>Expandable details: specs, pros, cons, best uses</li>
              <li>Links to official documentation</li>
            </ul>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
