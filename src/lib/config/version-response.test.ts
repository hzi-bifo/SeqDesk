import { describe, expect, it } from "vitest";

import { parseReleaseInfoResponse, parseUpdateCheckResponse } from "./version-response";

describe("version response parser", () => {
  it("parses release metadata and defaults optional fields", () => {
    expect(
      parseReleaseInfoResponse({
        version: " 1.2.3 ",
        downloadUrl: " https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz ",
      })
    ).toEqual({
      version: "1.2.3",
      channel: "stable",
      releaseDate: "",
      downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
      checksum: "",
      releaseNotes: "",
      minNodeVersion: "",
      databaseRequirement: undefined,
      size: undefined,
    });
  });

  it("parses populated release metadata", () => {
    expect(
      parseReleaseInfoResponse({
        version: "1.2.3",
        channel: "stable",
        releaseDate: "2026-03-05",
        downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
        checksum: "sha256:deadbeef",
        releaseNotes: "Stability fixes",
        minNodeVersion: "18.0.0",
        databaseRequirement: "postgresql",
        size: "1048576",
      })
    ).toEqual({
      version: "1.2.3",
      channel: "stable",
      releaseDate: "2026-03-05",
      downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
      checksum: "sha256:deadbeef",
      releaseNotes: "Stability fixes",
      minNodeVersion: "18.0.0",
      databaseRequirement: "postgresql",
      size: 1048576,
    });
  });

  it("rejects missing required release fields", () => {
    expect(() => parseReleaseInfoResponse({ downloadUrl: "https://example.com" })).toThrow(
      /version/
    );
    expect(() => parseReleaseInfoResponse({ version: "1.2.3" })).toThrow(/downloadUrl/);
  });

  it("rejects invalid release sizes", () => {
    expect(() =>
      parseReleaseInfoResponse({
        version: "1.2.3",
        downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
        size: -1,
      })
    ).toThrow(/size/);
  });

  it("rejects unsupported database requirements", () => {
    expect(() =>
      parseReleaseInfoResponse({
        version: "1.2.3",
        downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
        databaseRequirement: "sqlite",
      })
    ).toThrow(/databaseRequirement/);
  });

  it("rejects non-object release payloads", () => {
    expect(() => parseReleaseInfoResponse(null)).toThrow(/release payload/);
  });

  it("rejects non-string optional release fields", () => {
    expect(() =>
      parseReleaseInfoResponse({
        version: "1.2.3",
        downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
        checksum: 123,
      })
    ).toThrow(/checksum/);
  });

  it("parses update-check payloads with a latest release", () => {
    expect(
      parseUpdateCheckResponse({
        updateAvailable: true,
        latest: {
          version: "1.2.3",
          downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
          releaseNotes: "New release",
        },
      })
    ).toEqual({
      updateAvailable: true,
      latest: {
        version: "1.2.3",
        channel: "stable",
        releaseDate: "",
        downloadUrl: "https://downloads.seqdesk.com/seqdesk-1.2.3.tar.gz",
        checksum: "",
        releaseNotes: "New release",
        minNodeVersion: "",
        databaseRequirement: undefined,
        size: undefined,
      },
    });
  });

  it("allows latest to be absent when no update is available", () => {
    expect(
      parseUpdateCheckResponse({
        updateAvailable: false,
        latest: null,
      })
    ).toEqual({
      updateAvailable: false,
      latest: null,
    });
  });

  it("rejects updateAvailable=true without a latest release", () => {
    expect(() =>
      parseUpdateCheckResponse({
        updateAvailable: true,
        latest: null,
      })
    ).toThrow(/latest is required/);
  });

  it("rejects non-boolean updateAvailable values", () => {
    expect(() =>
      parseUpdateCheckResponse({
        updateAvailable: "true",
        latest: null,
      })
    ).toThrow(/updateAvailable/);
  });
});
