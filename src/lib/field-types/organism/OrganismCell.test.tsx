// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganismCell } from "./OrganismCell";

interface Row {
  taxId?: string;
  scientificName?: string;
  tax_id?: string;
  scientific_name?: string;
  [key: string]: unknown;
}

/**
 * Build a minimal CellContext that satisfies the bits OrganismCell consumes:
 * getValue(), row.original / row.index, column.id / column.columnDef.meta and
 * table.options.meta.updateData.
 */
function makeCtx(opts: {
  value?: string;
  original?: Row;
  rowIndex?: number;
  columnId?: string;
  meta?: { editable?: boolean; fieldName?: string };
  updateData?: (rowIndex: number, updates: Record<string, unknown>) => void;
}): CellContext<Row, unknown> {
  const {
    value = "",
    original = {},
    rowIndex = 0,
    columnId = "organism",
    meta,
    updateData,
  } = opts;

  return {
    getValue: () => value,
    renderValue: () => value,
    row: { index: rowIndex, original } as never,
    column: {
      id: columnId,
      columnDef: { meta },
    } as never,
    table: {
      options: { meta: updateData ? { updateData } : {} },
    } as never,
    cell: {} as never,
  } as CellContext<Row, unknown>;
}

function getInput(rowIndex = 0, columnId = "organism"): HTMLInputElement {
  return screen.getByTestId(
    `sample-cell-${rowIndex}-${columnId}`
  ) as HTMLInputElement;
}

describe("OrganismCell", () => {
  beforeEach(() => {
    // shouldAdvanceTime lets the fake clock tick with real time so that
    // @testing-library async helpers (findBy*/waitFor) can poll, while still
    // allowing vi.advanceTimersByTime() to flush the component's blur setTimeout.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("renders a read-only display when the column is not editable", () => {
    render(
      <OrganismCell
        {...makeCtx({
          original: { taxId: "9606", scientificName: "Homo sapiens" },
          meta: { editable: false },
        })}
      />
    );

    // Read-only mode shows text, no editable input.
    expect(screen.getByText("Homo sapiens")).toBeTruthy();
    expect(screen.getAllByText("9606").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("sample-cell-0-organism")).toBeNull();
  });

  it("read-only mode falls back to a dash when nothing is set", () => {
    render(<OrganismCell {...makeCtx({ meta: { editable: false } })} />);
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("initializes the editable input from scientificName", () => {
    render(
      <OrganismCell
        {...makeCtx({
          original: { taxId: "9606", scientificName: "Homo sapiens" },
        })}
      />
    );
    expect(getInput().value).toBe("Homo sapiens");
    // taxId badge present.
    expect(screen.getByText("9606")).toBeTruthy();
  });

  it("supports snake_case row fields", () => {
    render(
      <OrganismCell
        {...makeCtx({
          original: { tax_id: "562", scientific_name: "Escherichia coli" },
        })}
      />
    );
    expect(getInput().value).toBe("Escherichia coli");
  });

  it("looks up the scientific name from a known taxId when name is missing", () => {
    render(<OrganismCell {...makeCtx({ original: { taxId: "562" } })} />);
    expect(getInput().value).toBe("Escherichia coli");
  });

  it("shows a TaxID label for an unknown taxId without a name", () => {
    render(<OrganismCell {...makeCtx({ original: { taxId: "999999999" } })} />);
    expect(getInput().value).toBe("TaxID: 999999999");
  });

  it("opens results on typing and calls updateData on selection", async () => {
    const updateData = vi.fn();
    render(<OrganismCell {...makeCtx({ updateData })} />);

    const input = getInput();
    fireEvent.change(input, { target: { value: "Escherichia" } });

    const option = await screen.findByText("Escherichia coli");
    // Use mouseDown because the option handler is onMouseDown.
    fireEvent.mouseDown(option);

    expect(updateData).toHaveBeenCalledWith(0, {
      taxId: "562",
      scientificName: "Escherichia coli",
    });
  });

  it("renders an NCBI search link inside the portal dropdown", async () => {
    render(<OrganismCell {...makeCtx({})} />);
    fireEvent.change(getInput(), { target: { value: "Escherichia" } });

    await screen.findByText("Escherichia coli");
    const link = screen.getByText(/Search NCBI for/).closest("a");
    expect(link?.getAttribute("href")).toContain("Escherichia");
  });

  it("shows the no-matches message with an NCBI link for unknown queries", async () => {
    render(<OrganismCell {...makeCtx({})} />);
    fireEvent.change(getInput(), { target: { value: "zzzzznotataxon" } });

    expect(
      await screen.findByText(/No matches\. Enter a valid NCBI Taxonomy ID/)
    ).toBeTruthy();
    expect(screen.getByText("Search NCBI Taxonomy")).toBeTruthy();
  });

  it("navigates with arrow keys and selects with Enter", async () => {
    const updateData = vi.fn();
    render(<OrganismCell {...makeCtx({ updateData })} />);

    const input = getInput();
    fireEvent.change(input, { target: { value: "metagenome" } });
    // Multiple organisms match "metagenome"; wait for the result list.
    await screen.findAllByText(/metagenome/);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateData).toHaveBeenCalledTimes(1);
    const [rowIdx, updates] = updateData.mock.calls[0];
    expect(rowIdx).toBe(0);
    expect((updates as { scientificName: string }).scientificName).toContain(
      "metagenome"
    );
  });

  it("closes the dropdown on Escape and on Tab", async () => {
    render(<OrganismCell {...makeCtx({})} />);
    const input = getInput();

    fireEvent.change(input, { target: { value: "Escherichia" } });
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Escherichia coli")).toBeNull();
    });

    // Reopen via focus (re-firing change with the same value is a no-op in
    // React's change tracking, so it would not reopen the dropdown).
    fireEvent.focus(input);
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() => {
      expect(screen.queryByText("Escherichia coli")).toBeNull();
    });
  });

  it("opens on ArrowDown when closed and there is a query", async () => {
    render(<OrganismCell {...makeCtx({})} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "coli" } });
    await screen.findByText("Escherichia coli");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Escherichia coli")).toBeNull();
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();
  });

  it("resolves a known numeric taxId on blur", () => {
    const updateData = vi.fn();
    render(<OrganismCell {...makeCtx({ updateData })} />);
    const input = getInput();

    fireEvent.change(input, { target: { value: "9606" } });
    fireEvent.blur(input);
    vi.advanceTimersByTime(200);

    expect(updateData).toHaveBeenCalledWith(0, {
      taxId: "9606",
      scientificName: "Homo sapiens",
    });
  });

  it("marks an unknown numeric taxId on blur", () => {
    const updateData = vi.fn();
    render(<OrganismCell {...makeCtx({ updateData })} />);
    const input = getInput();

    fireEvent.change(input, { target: { value: "123456789" } });
    fireEvent.blur(input);
    vi.advanceTimersByTime(200);

    expect(updateData).toHaveBeenCalledWith(0, {
      taxId: "123456789",
      scientificName: "Unknown (TaxID: 123456789)",
    });
  });

  it("opens the dropdown on focus when input already has a query", async () => {
    render(<OrganismCell {...makeCtx({})} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "coli" } });
    await screen.findByText("Escherichia coli");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Escherichia coli")).toBeNull();
    });

    fireEvent.focus(input);
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();
  });

  it("closes the dropdown when clicking outside the cell", async () => {
    render(<OrganismCell {...makeCtx({})} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "Escherichia" } });
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText("Escherichia coli")).toBeNull();
    });
  });

  it("respects a custom column id in the test id", () => {
    render(
      <OrganismCell
        {...makeCtx({
          columnId: "species",
          original: { scientificName: "Homo sapiens" },
        })}
      />
    );
    expect(getInput(0, "species").value).toBe("Homo sapiens");
  });
});
