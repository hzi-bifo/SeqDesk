import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedFs = {
  readdir: vi.fn(),
  stat: vi.fn(),
};

function createFileDirent(name: string) {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  };
}

describe("browseSequencingStorageFiles mocked filesystem edges", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedFs.readdir.mockReset();
    mockedFs.stat.mockReset();
    vi.doMock("fs/promises", () => mockedFs);
  });

  afterEach(() => {
    vi.doUnmock("fs/promises");
    vi.resetModules();
  });

  it("skips files whose stat call fails and keeps readable files", async () => {
    mockedFs.readdir.mockResolvedValue([
      createFileDirent("broken.fastq.gz"),
      createFileDirent("kept.fastq.gz"),
    ]);
    mockedFs.stat.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith("broken.fastq.gz")) {
        throw new Error("stat failed");
      }

      return {
        size: 42,
        mtime: new Date("2026-03-24T12:00:00.000Z"),
      };
    });

    const { browseSequencingStorageFiles } = await import("./browse");

    await expect(browseSequencingStorageFiles("/sequencing")).resolves.toEqual([
      {
        relativePath: "kept.fastq.gz",
        filename: "kept.fastq.gz",
        size: 42,
        modifiedAt: new Date("2026-03-24T12:00:00.000Z"),
      },
    ]);

    expect(mockedFs.readdir).toHaveBeenCalledWith("/sequencing", {
      withFileTypes: true,
    });
    expect(mockedFs.stat).toHaveBeenCalledWith(path.join("/sequencing", "broken.fastq.gz"));
    expect(mockedFs.stat).toHaveBeenCalledWith(path.join("/sequencing", "kept.fastq.gz"));
  });
});
