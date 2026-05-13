import { describe, expect, it } from "vitest";

import {
  PLATFORM_ILLUMINA_NOVASEQ_WGS,
  PLATFORM_ONT_MINION_WGS,
} from "./templates";
import { buildDummySeedDataset } from "./dummy-orders";

describe("dummy order seed dataset", () => {
  it("stores sequencing technology selections instead of legacy order platform values", () => {
    const dataset = buildDummySeedDataset({
      ownerUserId: "user-1",
      dataBasePath: "/tmp/seqdesk",
      primaryPlatform: PLATFORM_ILLUMINA_NOVASEQ_WGS,
    });

    expect(dataset.orders[0]).toMatchObject({
      platform: null,
      sequencingTechSelection: {
        technologyId: "illumina-novaseq",
        technologyName: "NovaSeq 6000/X",
        platformFamily: "illumina",
        readLengthClass: "short",
        supportedReadLayouts: ["single", "paired"],
      },
    });
  });

  it("captures long-read technology metadata for ONT dummy datasets", () => {
    const dataset = buildDummySeedDataset({
      ownerUserId: "user-1",
      dataBasePath: "/tmp/seqdesk",
      primaryPlatform: PLATFORM_ONT_MINION_WGS,
    });

    expect(dataset.orders[0].sequencingTechSelection).toMatchObject({
      technologyId: "ont-minion",
      platformFamily: "oxford-nanopore",
      readLengthClass: "long",
      supportedReadLayouts: ["single"],
    });
    expect(dataset.orders[0].platform).toBeNull();
  });
});
