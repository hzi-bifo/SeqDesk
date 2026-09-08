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
import { OTHER_COLOR, PALETTE, SubjectTimelineOverview, type SubjectsResponse } from "@/components/explore/views/SubjectTimelineOverview";
import { fetcher } from "@/lib/explore/client";
import type { ExploreDatasetDetail } from "@/lib/explore/types";
import type { SubjectCompositionPayload, SubjectHighlightsPayload } from "@/lib/explore/views/subject-timeline/types";

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

  if (subjectsError) {
    return (
      <PageContainer>
        <Link href={`/explore/datasets/${id}?scope=${encodeURIComponent(detail?.dataset.targetKey ?? "")}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Dataset</Link>
        <p className="mt-4 text-sm text-destructive">{String(subjectsError.message)}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link href={`/explore/datasets/${id}?scope=${encodeURIComponent(detail?.dataset.targetKey ?? "")}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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
          <SubjectTimelineOverview datasetId={id} filter={query} activeSubject={activeSubject} onSelect={setSubject} className="max-h-[70vh] overflow-y-auto" />
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
