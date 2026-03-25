import type { SequencingReadSummary } from "@/lib/sequencing/types";
import {
  formatAvgQuality,
  getFastqcMetricItems,
} from "@/lib/sequencing/display";

interface FastqcMetricBadgesProps {
  read: SequencingReadSummary | null | undefined;
}

export function FastqcMetricBadges({
  read,
}: FastqcMetricBadgesProps) {
  const metrics = getFastqcMetricItems(read);

  if (metrics.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {metrics.map((metric) => (
        <span
          key={metric.label}
          className="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {metric.label} {formatAvgQuality(metric.value)}
        </span>
      ))}
    </div>
  );
}
