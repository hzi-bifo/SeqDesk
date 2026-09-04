"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, ListChecks } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { fetcher } from "@/lib/explore/client";
import type { ExploreDatasetDetail } from "@/lib/explore/types";
import type { SubjectCompositionPayload, SubjectHighlightsPayload, SubjectsTablePayload } from "@/lib/explore/views/subject-timeline/types";

type SubjectsResponse = SubjectsTablePayload & { cacheToken: string; groups: string[]; dropped: { missingKeys: number; control: number; isolate: number } };

const PALETTE = [
  "#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD",
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22",
];
const OTHER_COLOR = "#d9d9d9";

export default function SubjectTimelinePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [subject, setSubject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [measure, setMeasure] = useState<"ra" | "reads">("ra");

  const { data: detail } = useSWR<{ dataset: ExploreDatasetDetail }>(`/api/explore/datasets/${id}`, fetcher);
  const base = `/api/explore/datasets/${id}/views/subject-timeline`;
  const { data: subjects, error: subjectsError } = useSWR<SubjectsResponse>(`${base}?part=subjects`, fetcher);
  const groups = useMemo(() => subjects?.groups.slice(0, 2) ?? [], [subjects]);
  const groupsParam = groups.length ? `&groups=${encodeURIComponent(groups.join(","))}` : "";

  const activeSubject = subject ?? subjects?.patients[0]?.patient ?? null;
  const activeRow = subjects?.patients.find((row) => row.patient === activeSubject) ?? null;
  const activeGroups = groups.filter((group) => activeRow?.sampletypes.includes(group));
  const { data: highlights } = useSWR<SubjectHighlightsPayload>(activeSubject ? `${base}?part=highlights&subject=${encodeURIComponent(activeSubject)}${groupsParam}` : null, fetcher);

  const visible = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return (subjects?.patients ?? []).filter((row) => !lower || row.patient.toLowerCase().includes(lower));
  }, [subjects, query]);

  if (subjectsError) {
    return (
      <PageContainer>
        <Link href={`/explore/datasets/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Dataset</Link>
        <p className="mt-4 text-sm text-destructive">{String(subjectsError.message)}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link href={`/explore/datasets/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {detail?.dataset.name ?? "Dataset"}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Subject timeline</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            One subject at a time: sampling days per specimen type, the community composition over time, and curated
            organisms of interest. Relative abundance is recomputed from read counts after removing curated artifacts.
          </p>
          {subjects && (
            <p className="mt-1 text-xs text-muted-foreground">
              {subjects.patients.length} subjects, days {subjects.day_min} to {subjects.day_max}
              {subjects.dropped.control + subjects.dropped.isolate + subjects.dropped.missingKeys > 0 &&
                `; excluded ${subjects.dropped.control} control, ${subjects.dropped.isolate} isolate and ${subjects.dropped.missingKeys} incomplete rows`}
            </p>
          )}
        </div>
        {detail && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/explore/curation?scope=${encodeURIComponent(detail.dataset.targetKey)}`}>
              <ListChecks className="mr-2 h-4 w-4" />
              Curated lists
            </Link>
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="rounded-lg border">
          <div className="border-b p-2">
            <Input placeholder="Find a subject" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a subject" />
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {!subjects ? (
              <div className="space-y-2 p-3"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Subject</th>
                    <th className="px-2 py-1.5 text-right font-medium">Days</th>
                    <th className="px-2 py-1.5 text-right font-medium">Span</th>
                    <th className="px-2 py-1.5 font-medium">Timeline</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.patient} className={`cursor-pointer border-t ${row.patient === activeSubject ? "bg-secondary" : "hover:bg-muted/30"}`} onClick={() => setSubject(row.patient)}>
                      <td className="px-3 py-1.5 font-medium">{row.patient}{row.site ? <span className="ml-1 text-xs text-muted-foreground">{row.site}</span> : null}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.n_days}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.span}</td>
                      <td className="px-2 py-1.5">
                        <MiniTimeline row={row} dayMin={subjects.day_min} dayMax={subjects.day_max} groups={groups} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          {activeRow && (
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{activeRow.patient}</h2>
              <span className="text-sm text-muted-foreground">{activeRow.n_samples} libraries on {activeRow.n_days} days, {activeRow.sampletypes.join(" and ")}</span>
              <span className="flex-1" />
              <div className="flex rounded-md border text-xs">
                {(["ra", "reads"] as const).map((option) => (
                  <button key={option} type="button" onClick={() => setMeasure(option)} className={`px-2 py-1 ${measure === option ? "bg-secondary font-medium" : "text-muted-foreground"}`}>
                    {option === "ra" ? "Relative abundance" : "Reads"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeSubject && activeGroups.map((group) => (
            <CompositionPanel key={`${activeSubject}:${group}`} base={base} subject={activeSubject} group={group} groupsParam={groupsParam} measure={measure} />
          ))}
          {activeSubject && activeGroups.length === 0 && activeRow && (
            <p className="text-sm text-muted-foreground">This subject has no samples in the primary specimen types ({groups.join(", ")}).</p>
          )}
          {highlights && <HighlightsPanel highlights={highlights} />}
        </div>
      </div>
    </PageContainer>
  );
}

function MiniTimeline({ row, dayMin, dayMax, groups }: { row: SubjectsTablePayload["patients"][number]; dayMin: number; dayMax: number; groups: string[] }) {
  const span = Math.max(dayMax - dayMin, 1);
  return (
    <svg viewBox="0 0 120 12" className="h-3 w-28" aria-hidden="true">
      <line x1="0" y1="6" x2="120" y2="6" stroke="currentColor" strokeOpacity="0.15" />
      {groups.map((group, groupIndex) =>
        (row.days_by_sampletype[group] ?? []).map((day) => (
          <circle key={`${group}-${day}`} cx={((day - dayMin) / span) * 116 + 2} cy={groupIndex === 0 ? 4 : 8} r="2" fill={PALETTE[groupIndex % PALETTE.length]} />
        ))
      )}
    </svg>
  );
}

function CompositionPanel({ base, subject, group, groupsParam, measure }: { base: string; subject: string; group: string; groupsParam: string; measure: "ra" | "reads" }) {
  const { data, error } = useSWR<SubjectCompositionPayload>(`${base}?part=composition&subject=${encodeURIComponent(subject)}&group=${encodeURIComponent(group)}${groupsParam}`, fetcher);
  if (error) return <p className="text-sm text-destructive">{String(error.message)}</p>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  if (data.days.length === 0) return <p className="text-sm text-muted-foreground">{group}: no retained taxa on any day.</p>;
  const stacked = measure === "ra" ? data.stacked : data.stacked_reads;
  const traces = data.taxa.map((taxon, index) => ({
    type: "bar",
    name: taxon,
    x: data.days.map((day) => `Day ${day}`),
    y: stacked[taxon] ?? [],
    marker: { color: taxon === "Other" ? OTHER_COLOR : PALETTE[index % PALETTE.length] },
    hovertemplate: `${taxon}<br>%{x}: %{y:.2f}${measure === "ra" ? " %" : " reads"}<extra></extra>`,
  }));
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{group}</span>
        <span className="text-muted-foreground">{data.n_libraries} libraries, {data.collection_days.length} collection days</span>
        {data.day_support.some((day) => day.mixed_depletion) && <Badge variant="outline">mixed protocols</Badge>}
      </div>
      <PlotlyChart
        data={traces}
        height={340}
        layout={{
          barmode: "stack",
          yaxis: { title: { text: measure === "ra" ? "Relative abundance (%)" : "Assigned reads" }, rangemode: "tozero" },
          xaxis: { title: { text: "Study day" } },
          legend: { orientation: "h", y: -0.3, font: { size: 10 } },
          margin: { l: 56, r: 16, t: 8, b: 48 },
        }}
      />
    </div>
  );
}

function HighlightsPanel({ highlights }: { highlights: SubjectHighlightsPayload }) {
  const shifts = Object.entries(highlights.shifts);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border p-3 text-sm">
        <h3 className="font-semibold">Organisms of interest</h3>
        {highlights.curated_hits.length === 0 ? (
          <p className="mt-2 text-muted-foreground">No curated organism detected. Curated lists decide what is highlighted here.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {highlights.curated_hits.slice(0, 30).map((hit) => (
              <li key={`${hit.name}-${hit.sampletype}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{hit.name}</span>
                <span className="text-muted-foreground">{hit.sampletype}, peak {hit.peak_ra.toFixed(2)} % on day {hit.day}</span>
                {hit.memberships.map((membership) => (
                  <span key={membership.list_id ?? membership.label ?? ""} className="rounded-full px-1.5 text-xs" style={{ background: `${membership.color ?? "#999"}22`, color: membership.color ?? undefined }}>
                    {membership.label ?? membership.tier}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border p-3 text-sm">
        <h3 className="font-semibold">Community shifts</h3>
        {shifts.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Not enough days to compare.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shifts.map(([group, shift]) => (
              <li key={group}>
                <div className="font-medium">{group}</div>
                <div className="text-muted-foreground">
                  {shift.n_days} days, dominant taxon changed {shift.n_dominance_changes} time{shift.n_dominance_changes === 1 ? "" : "s"}
                  {shift.dominant_first && shift.dominant_last && ` (${shift.dominant_first.taxon} to ${shift.dominant_last.taxon})`}
                  {shift.max_turnover && `; largest turnover ${shift.max_turnover.value} between day ${shift.max_turnover.from_day} and ${shift.max_turnover.to_day}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
