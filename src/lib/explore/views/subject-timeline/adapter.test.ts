import { describe, expect, it } from "vitest";
import { adaptRowsForSubjectTimeline, curationFromLists } from "./adapter";
import type { ExploreRowRecord } from "../../types";

function record(rowIndex: number, data: ExploreRowRecord["data"]): ExploreRowRecord {
  return { rowIndex, sampleId: null, subjectId: null, key: null, data };
}

const roles = { sample: "A-ID", subject: "subject", timepoint: "timepoint", group: "specimen_type", taxon: "taxonName", count: "numReads", taxon_id: "taxonID" };
const columns = ["A-ID", "subject", "timepoint", "specimen_type", "taxonName", "numReads", "taxonID", "superkingdom", "cohort", "is_isolate", "depletion_protocol"];

describe("subject timeline adapter", () => {
  it("maps roles onto the row contract and drops controls, isolates and incomplete rows", () => {
    const result = adaptRowsForSubjectTimeline(
      [
        record(0, { "A-ID": "A1_hd_U_D1", subject: "A1", timepoint: 1, specimen_type: "Urine", taxonName: "E. coli", numReads: "12.5", taxonID: 562, superkingdom: "Bacteria", cohort: "clinical", is_isolate: false, depletion_protocol: "hd" }),
        record(1, { "A-ID": "C1", subject: "C1", timepoint: 1, specimen_type: "Control/Env", taxonName: "x", numReads: 1, taxonID: null, superkingdom: null, cohort: "control", is_isolate: false, depletion_protocol: null }),
        record(2, { "A-ID": "A1=iso", subject: "A1", timepoint: 1, specimen_type: "Urine", taxonName: "x", numReads: 1, taxonID: null, superkingdom: null, cohort: "clinical", is_isolate: true, depletion_protocol: null }),
        record(3, { "A-ID": "A2", subject: "A2", timepoint: null, specimen_type: "Urine", taxonName: "x", numReads: 1, taxonID: null, superkingdom: null, cohort: "clinical", is_isolate: false, depletion_protocol: null }),
      ],
      roles,
      columns
    );
    expect(result.missingRoles).toEqual([]);
    expect(result.rows).toEqual([
      { sample: "A1_hd_U_D1", subject: "A1", timepoint: 1, group: "Urine", taxon: "E. coli", taxonId: "562", superkingdom: "Bacteria", count: 12.5, site: null, protocol: "hd" },
    ]);
    expect(result.dropped).toEqual({ missingKeys: 1, control: 1, isolate: 1 });
  });

  it("reports missing required roles", () => {
    const result = adaptRowsForSubjectTimeline([], { sample: "a" }, ["a"]);
    expect(result.missingRoles).toEqual(["subject", "timepoint", "taxon", "count"]);
  });

  it("builds curation memberships and artifacts from lists", () => {
    const curation = curationFromLists([
      { listId: "urine_verified", label: "Urine verified", role: "pathogen", site: "Urine", tier: "verified", color: "#c00", entries: ["Escherichia coli", " Klebsiella pneumoniae "] },
      { listId: "artifacts", label: "Artifacts", role: "artifact", site: null, tier: null, color: null, entries: ["Toxoplasma gondii"] },
      { listId: "other", label: "Ignored", role: "note", site: null, tier: null, color: null, entries: ["x"] },
    ]);
    expect(curation.artifacts).toEqual(["Toxoplasma gondii"]);
    expect(curation.memberships["escherichia coli"]).toEqual([
      { listId: "urine_verified", label: "Urine verified", role: "pathogen", site: "Urine", tier: "verified", color: "#c00" },
    ]);
    expect(curation.memberships["klebsiella pneumoniae"]).toHaveLength(1);
    expect(curation.memberships["x"]).toBeUndefined();
  });
});
