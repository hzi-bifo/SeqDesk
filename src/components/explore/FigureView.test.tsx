// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDownloadUrl, FigureView, PREVIEW_ROW_LIMIT } from "./FigureView";

// react-plotly.js/factory is replaced by a stub that records the Plotly build
// it receives and the props of every render; plotly.js-cartesian-dist-min is
// replaced because the real bundle only runs in a browser.
const plotStub = vi.hoisted(() => ({
  factoryCalls: [] as unknown[],
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("react-plotly.js/factory", () => ({
  default: (plotly: unknown) => {
    plotStub.factoryCalls.push(plotly);
    return function StubPlot(props: Record<string, unknown>) {
      plotStub.lastProps = props;
      return <div data-testid="plot" data-traces={(props.data as unknown[]).length} />;
    };
  },
}));

vi.mock("plotly.js-cartesian-dist-min", () => ({ default: { stub: "plotly" } }));

function textResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<ReturnType<typeof textResponse>>>();

beforeEach(() => {
  fetchMock.mockReset();
  plotStub.lastProps = null;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL = "/api/explore/runs/run-1/artifacts/art-1";

describe("FigureView", () => {
  describe("footer", () => {
    it("shows the title, description and a download link", () => {
      render(<FigureView url={URL} format="png" title="Alpha diversity" description="Shannon index per sample" />);

      expect(screen.getByText("Alpha diversity")).toBeTruthy();
      expect(screen.getByText("Shannon index per sample")).toBeTruthy();
      const link = screen.getByTestId("figure-download") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(`${URL}?download=1`);
      expect(link.hasAttribute("download")).toBe(true);
      expect(link.textContent).toContain("Download");
    });

    it("falls back to a generic label and appends to an existing query string", () => {
      render(<FigureView url={`${URL}?rev=2`} format="png" />);

      expect(screen.getByText("Artifact")).toBeTruthy();
      expect(screen.getByTestId("figure-download").getAttribute("href")).toBe(`${URL}?rev=2&download=1`);
    });

    it("exposes the download URL builder", () => {
      expect(buildDownloadUrl("/a/b")).toBe("/a/b?download=1");
      expect(buildDownloadUrl("/a/b?x=1")).toBe("/a/b?x=1&download=1");
    });

    it("applies className and the format marker", () => {
      render(<FigureView url={URL} format="svg" className="custom-figure" />);

      const figure = screen.getByTestId("figure-view");
      expect(figure.classList.contains("custom-figure")).toBe(true);
      expect(figure.getAttribute("data-format")).toBe("svg");
    });
  });

  describe("images", () => {
    it("renders png artifacts as an image without fetching", () => {
      render(<FigureView url={URL} format="png" title="Heatmap" height={300} />);

      const image = screen.getByRole("img", { name: "Heatmap" }) as HTMLImageElement;
      expect(image.getAttribute("src")).toBe(URL);
      expect(image.style.maxHeight).toBe("300px");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("renders svg artifacts as an image with a fallback alt text", () => {
      render(<FigureView url={URL} format="svg" />);

      expect((screen.getByRole("img", { name: "Figure" }) as HTMLImageElement).getAttribute("src")).toBe(URL);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("html", () => {
    it("renders a sandboxed iframe without same-origin access", () => {
      render(<FigureView url={URL} format="html" title="Interactive plot" height={500} />);

      const frame = screen.getByTitle("Interactive plot") as HTMLIFrameElement;
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("src")).toBe(URL);
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(frame.style.height).toBe("500px");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("pdf", () => {
    it("embeds the document with a download fallback", () => {
      render(<FigureView url={URL} format="pdf" title="Report" />);

      const embed = screen.getByLabelText("Report") as HTMLObjectElement;
      expect(embed.tagName).toBe("OBJECT");
      expect(embed.getAttribute("data")).toBe(URL);
      expect(embed.getAttribute("type")).toBe("application/pdf");
      expect(embed.style.height).toBe("420px");
      const fallback = screen.getByText("Download the PDF") as HTMLAnchorElement;
      expect(fallback.getAttribute("href")).toBe(`${URL}?download=1`);
      expect(fallback.hasAttribute("download")).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("delimited tables", () => {
    it("renders a tsv preview with a header row", async () => {
      fetchMock.mockResolvedValue(textResponse("sample\treads\tgc\r\nS1\t1200\t0.51\r\nS2\t800\t0.47\r\n"));
      render(<FigureView url={URL} format="tsv" title="Summary" />);

      expect(screen.getByTestId("figure-skeleton")).toBeTruthy();
      const table = await screen.findByRole("table");
      expect(fetchMock).toHaveBeenCalledWith(URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => cell.textContent);
      expect(headers).toEqual(["sample", "reads", "gc"]);
      const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent)
      );
      expect(rows).toEqual([
        ["S1", "1200", "0.51"],
        ["S2", "800", "0.47"],
      ]);
      expect(screen.queryByTestId("figure-skeleton")).toBeNull();
      expect(screen.queryByText(/Showing the first/)).toBeNull();
    });

    it("splits csv on commas and pads short rows", async () => {
      fetchMock.mockResolvedValue(textResponse("a,b,c\n1,2,3\n4,5\n"));
      render(<FigureView url={URL} format="csv" />);

      const table = await screen.findByRole("table");
      const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
        Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent)
      );
      expect(rows).toEqual([
        ["1", "2", "3"],
        ["4", "5", ""],
      ]);
    });

    it("limits the preview to the first 200 rows", async () => {
      const lines = ["id\tvalue"];
      for (let index = 0; index < 250; index += 1) {
        lines.push(`row${index}\t${index}`);
      }
      fetchMock.mockResolvedValue(textResponse(lines.join("\n")));
      render(<FigureView url={URL} format="tsv" />);

      const table = await screen.findByRole("table");
      expect(table.querySelectorAll("tbody tr")).toHaveLength(PREVIEW_ROW_LIMIT);
      expect(screen.getByText(`Showing the first ${PREVIEW_ROW_LIMIT} of 250 rows. Download the file for the full table.`)).toBeTruthy();
    });

    it("explains an empty file", async () => {
      fetchMock.mockResolvedValue(textResponse("\n"));
      render(<FigureView url={URL} format="csv" />);

      expect(await screen.findByText("The file is empty.")).toBeTruthy();
    });
  });

  describe("text", () => {
    it("renders markdown and plain text verbatim in a pre block", async () => {
      fetchMock.mockResolvedValue(textResponse("# Title\n\nSome *notes*"));
      render(<FigureView url={URL} format="md" />);

      const pre = await screen.findByTestId("figure-text");
      expect(pre.tagName).toBe("PRE");
      expect(pre.textContent).toBe("# Title\n\nSome *notes*");
    });

    it("renders txt artifacts", async () => {
      fetchMock.mockResolvedValue(textResponse("plain log line"));
      render(<FigureView url={URL} format="txt" height={100} />);

      const pre = await screen.findByTestId("figure-text");
      expect(pre.textContent).toBe("plain log line");
      expect(pre.style.maxHeight).toBe("100px");
    });

    it("pretty-prints json artifacts", async () => {
      fetchMock.mockResolvedValue(textResponse('{"a":1,"b":[1,2]}'));
      render(<FigureView url={URL} format="json" />);

      const pre = await screen.findByTestId("figure-text");
      expect(pre.textContent).toBe(JSON.stringify({ a: 1, b: [1, 2] }, null, 2));
    });

    it("falls back to the raw payload for malformed json", async () => {
      fetchMock.mockResolvedValue(textResponse("{not json"));
      render(<FigureView url={URL} format="json" />);

      expect((await screen.findByTestId("figure-text")).textContent).toBe("{not json");
    });
  });

  describe("plotly-json", () => {
    const figure = {
      data: [
        { type: "bar", x: ["a", "b"], y: [1, 2] },
        { type: "scatter", x: [1, 2], y: [3, 4] },
      ],
      layout: { title: { text: "Counts" }, width: 900, height: 700, margin: { t: 40 } },
      config: { scrollZoom: true, displaylogo: true },
    };

    it("renders the figure through the Plotly component with a responsive layout and toolbar config", async () => {
      fetchMock.mockResolvedValue(textResponse(JSON.stringify(figure)));
      render(<FigureView url={URL} format="plotly-json" title="Counts" height={360} />);

      expect(screen.getByTestId("figure-skeleton")).toBeTruthy();
      const plot = await screen.findByTestId("plot");
      expect(plot.getAttribute("data-traces")).toBe("2");
      expect(plotStub.factoryCalls[0]).toEqual({ stub: "plotly" });

      const props = plotStub.lastProps;
      expect(props).not.toBeNull();
      expect(props?.data).toEqual(figure.data);
      expect(props?.layout).toEqual({ title: { text: "Counts" }, margin: { t: 40 }, autosize: true });
      expect(props?.config).toEqual({
        scrollZoom: true,
        displaylogo: false,
        responsive: true,
        toImageButtonOptions: { format: "png", scale: 2 },
      });
      expect(props?.useResizeHandler).toBe(true);
      expect(props?.style).toEqual({ width: "100%", height: 360 });
      expect(screen.queryByTestId("figure-skeleton")).toBeNull();
    });

    it("accepts a figure without layout or config", async () => {
      fetchMock.mockResolvedValue(textResponse(JSON.stringify({ data: [{ type: "bar", y: [1] }] })));
      render(<FigureView url={URL} format="plotly-json" />);

      await screen.findByTestId("plot");
      expect(plotStub.lastProps?.layout).toEqual({ autosize: true });
      expect(plotStub.lastProps?.config).toEqual({
        displaylogo: false,
        responsive: true,
        toImageButtonOptions: { format: "png", scale: 2 },
      });
    });

    it("reports invalid JSON", async () => {
      fetchMock.mockResolvedValue(textResponse("{ nope"));
      render(<FigureView url={URL} format="plotly-json" />);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/could not be parsed/);
      expect(screen.queryByTestId("plot")).toBeNull();
    });

    it("reports JSON that is not a Plotly figure", async () => {
      fetchMock.mockResolvedValue(textResponse(JSON.stringify({ layout: {} })));
      render(<FigureView url={URL} format="plotly-json" />);

      expect((await screen.findByRole("alert")).textContent).toContain('"data" array');
    });

    it("reports failed requests", async () => {
      fetchMock.mockResolvedValue(textResponse("gone", 404));
      render(<FigureView url={URL} format="plotly-json" />);

      expect((await screen.findByRole("alert")).textContent).toContain("HTTP 404");
    });

    it("reports network errors", async () => {
      fetchMock.mockRejectedValue(new Error("Failed to fetch"));
      render(<FigureView url={URL} format="txt" />);

      expect((await screen.findByRole("alert")).textContent).toBe("Failed to fetch");
    });

    it("reloads when the url changes", async () => {
      fetchMock.mockResolvedValueOnce(textResponse("first"));
      const { rerender } = render(<FigureView url={URL} format="txt" />);
      expect((await screen.findByTestId("figure-text")).textContent).toBe("first");

      let resolveSecond: (value: ReturnType<typeof textResponse>) => void = () => {};
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );
      rerender(<FigureView url={`${URL}-b`} format="txt" />);

      // Stale content is not shown for the new artifact while it loads.
      expect(screen.getByTestId("figure-skeleton")).toBeTruthy();
      expect(screen.queryByTestId("figure-text")).toBeNull();
      resolveSecond(textResponse("second"));

      expect((await screen.findByTestId("figure-text")).textContent).toBe("second");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(`${URL}-b`);
    });

    it("aborts the in-flight request on unmount", async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => {});
      });
      const { unmount } = render(<FigureView url={URL} format="txt" />);
      await waitFor(() => expect(signal).toBeDefined());
      expect(signal?.aborted).toBe(false);

      unmount();

      expect(signal?.aborted).toBe(true);
    });
  });
});

describe("FigureView chart library failure", () => {
  afterEach(() => {
    vi.doUnmock("react-plotly.js/factory");
    vi.resetModules();
  });

  it("shows a readable error when the chart library cannot be initialised", async () => {
    // A fresh module instance gets an empty loader cache; the wrapper factory
    // failing stands in for a chunk that could not be loaded or evaluated.
    vi.resetModules();
    vi.doMock("react-plotly.js/factory", () => ({
      default: () => {
        throw new Error("chunk load failed");
      },
    }));
    const { FigureView: IsolatedFigureView } = await import("./FigureView");
    fetchMock.mockResolvedValue(textResponse(JSON.stringify({ data: [] })));

    render(<IsolatedFigureView url={URL} format="plotly-json" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The chart library could not be loaded: chunk load failed");
    expect(screen.queryByTestId("plot")).toBeNull();
  });
});
