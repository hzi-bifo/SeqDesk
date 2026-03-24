import { describe, expect, it } from "vitest";

import { buildSimulatedFastq } from "./fastq";

interface FastqRecord {
  header: string;
  sequence: string;
  plus: string;
  quality: string;
}

function parseFastq(buffer: Buffer): FastqRecord[] {
  const lines = buffer.toString("utf8").trim().split("\n");
  const records: FastqRecord[] = [];
  for (let index = 0; index < lines.length; index += 4) {
    records.push({
      header: lines[index],
      sequence: lines[index + 1],
      plus: lines[index + 2],
      quality: lines[index + 3],
    });
  }
  return records;
}

describe("buildSimulatedFastq", () => {
  it("produces deterministic paired-end output for the same inputs", () => {
    const first = buildSimulatedFastq({
      sampleId: "SAMPLE_A",
      sampleIndex: 2,
      readCount: 3,
      readLength: 75,
    });
    const second = buildSimulatedFastq({
      sampleId: "SAMPLE_A",
      sampleIndex: 2,
      readCount: 3,
      readLength: 75,
    });

    expect(first.read1.toString("utf8")).toBe(second.read1.toString("utf8"));
    expect(first.read2?.toString("utf8")).toBe(second.read2?.toString("utf8"));

    const read1Records = parseFastq(first.read1);
    const read2Records = parseFastq(first.read2 as Buffer);

    expect(read1Records).toHaveLength(3);
    expect(read2Records).toHaveLength(3);
    expect(read1Records[0].header).toContain("1:N:0:SAMPLE_A");
    expect(read2Records[0].header).toContain("2:N:0:SAMPLE_A");
    expect(read1Records[0].sequence).toHaveLength(75);
    expect(read1Records[0].quality).toHaveLength(75);
    expect(read1Records[0].plus).toBe("+");
  });

  it("supports single-end output and clamps low read count and length inputs", () => {
    const result = buildSimulatedFastq({
      sampleId: "SINGLE_END",
      sampleIndex: 1,
      readCount: 0,
      readLength: 5,
      pairedEnd: false,
    });

    const records = parseFastq(result.read1);

    expect(result.read2).toBeNull();
    expect(records).toHaveLength(1);
    expect(records[0].header).toContain("1:N:0:SINGLE_END");
    expect(records[0].sequence).toHaveLength(25);
    expect(records[0].quality).toHaveLength(25);
  });

  it("changes the simulated output when the sample index changes", () => {
    const first = buildSimulatedFastq({
      sampleId: "SAMPLE_A",
      sampleIndex: 0,
      readCount: 2,
      readLength: 50,
    });
    const second = buildSimulatedFastq({
      sampleId: "SAMPLE_A",
      sampleIndex: 1,
      readCount: 2,
      readLength: 50,
    });

    expect(first.read1.toString("utf8")).not.toBe(second.read1.toString("utf8"));
    expect(first.read2?.toString("utf8")).not.toBe(second.read2?.toString("utf8"));
  });
});
