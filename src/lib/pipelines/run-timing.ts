type RunTimingInput = {
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function formatRunDuration(milliseconds: number): string | null {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}${hours % 24 ? ` ${hours % 24} hr` : ""}`;
}

function relativeTime(value: number, now: number): string {
  const elapsed = Math.max(0, now - value);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  const days = Math.floor(elapsed / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatRunDateTime(value: string | null): string {
  const time = timestamp(value);
  return time === null ? "Not recorded" : new Date(time).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
}

export function getRunTiming(run: RunTimingInput, now = Date.now()) {
  const started = timestamp(run.startedAt);
  const ended = timestamp(run.completedAt);
  const created = timestamp(run.createdAt);
  const waiting = run.status === "pending" || run.status === "queued";
  const running = run.status === "running";
  // A terminal run without an end time must never keep accumulating runtime.
  const duration = !waiting && started !== null
    ? formatRunDuration((ended ?? (running ? now : NaN)) - started)
    : null;
  const reference = started ?? ended ?? created;
  const prefix = started !== null ? "" : ended !== null ? "Ended " : "Added ";

  return {
    relativeLabel: reference === null ? "Time not recorded" : `${prefix}${relativeTime(reference, now)}`,
    dateTime: reference === null ? undefined : new Date(reference).toISOString(),
    duration,
    durationLabel: waiting || (started === null && ended === null && run.status === "cancelled")
      ? "Not started"
      : duration
        ? running && ended === null ? `${duration} so far` : `Took ${duration}`
        : "Duration not recorded",
    exactTimes: [
      `Added: ${formatRunDateTime(run.createdAt)}`,
      `Started: ${formatRunDateTime(run.startedAt)}`,
      `Ended: ${ended === null && running ? "Still running" : formatRunDateTime(run.completedAt)}`,
    ].join("\n"),
  };
}
