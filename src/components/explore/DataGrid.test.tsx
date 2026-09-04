// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createObjectURL: vi.fn<(blob: Blob) => string>(() => "blob:seqdesk-grid"),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
}));

// Radix menus render through portals and rely on pointer APIs jsdom lacks, so the
// menu primitives become plain pass-through elements here (content always visible).
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.(new Event("select"))}>
      {children}
    </button>
  ),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    disabled,
    onCheckedChange,
  }: {
    children: ReactNode;
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={() => onCheckedChange?.(!checked)}
      />
      {children}
    </label>
  ),
}));

import { DataGrid, type DataGridColumn, type DataGridRow } from "./DataGrid";

const columns: DataGridColumn[] = [
  { key: "sample", label: "Sample", type: "string", role: "sample", group: "identity" },
  { key: "taxon", label: "Taxon", type: "string", role: "taxon", group: "pipeline", editable: true },
  { key: "abundance", label: "Abundance", type: "number", group: "pipeline", editable: true },
  { key: "passed", label: "Passed QC", type: "boolean", group: "study" },
];

const rows: DataGridRow[] = [
  {
    rowKey: "r1",
    data: { sample: "S1", taxon: "Escherichia coli", abundance: 12.5, passed: true },
  },
  {
    rowKey: "r2",
    data: { sample: "S2", taxon: "Bacteroides fragilis", abundance: 0.123456789, passed: false },
    flags: ["contaminant"],
  },
  {
    rowKey: "r3",
    data: { sample: "S3", taxon: 'Lactobacillus, "reuteri"', abundance: null, passed: null },
    excluded: true,
    edited: ["taxon"],
  },
  {
    rowKey: "r4",
    data: { sample: "S4", taxon: "Akkermansia muciniphila", abundance: 3, passed: true },
  },
];

function grid(): HTMLElement {
  return screen.getByRole("grid");
}

function bodyRows(): HTMLTableRowElement[] {
  return Array.from(grid().querySelectorAll<HTMLTableRowElement>("tbody tr"));
}

function columnTexts(colIndex: number): string[] {
  return bodyRows().map(
    (row) => row.querySelector(`td[data-col-index="${colIndex}"]`)?.textContent ?? ""
  );
}

function cell(rowIndex: number, colIndex: number): HTMLTableCellElement {
  const element = grid().querySelector<HTMLTableCellElement>(
    `td[data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`
  );
  if (!element) throw new Error(`No cell at row ${rowIndex}, column ${colIndex}`);
  return element;
}

function headerCell(label: string): HTMLTableCellElement {
  const header = screen.getByRole("button", { name: `Sort by ${label}` }).closest("th");
  if (!header) throw new Error(`No header for ${label}`);
  return header;
}

describe("DataGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectURL,
    });
    HTMLAnchorElement.prototype.click = mocks.anchorClick;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders headers with role badges and group tints, and formats cell values", () => {
    render(<DataGrid columns={columns} rows={rows} />);

    const headerRow = within(grid()).getAllByRole("row")[0];
    expect(within(headerRow).getByRole("button", { name: "Sort by Sample" })).toBeTruthy();
    expect(within(headerRow).getByText("taxon")).toBeTruthy();
    expect(headerCell("Taxon").className).toContain("emerald");
    expect(headerCell("Sample").className).toContain("bg-muted");
    expect(headerCell("Sample").getAttribute("aria-sort")).toBe("none");

    expect(columnTexts(0)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(columnTexts(2)).toEqual(["12.5", "0.123457", "", "3"]);
    expect(columnTexts(3)).toEqual(["true", "false", "", "true"]);
    expect(cell(0, 2).className).toContain("text-right");
    expect(cell(1, 2).getAttribute("title")).toBe("0.123456789");
    expect(within(grid()).getByText("contaminant")).toBeTruthy();
    expect(screen.getByText("4 rows")).toBeTruthy();
  });

  it("hides columns through the controlled prop and reports toggles", () => {
    const onHiddenColumnsChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        hiddenColumns={["abundance"]}
        onHiddenColumnsChange={onHiddenColumnsChange}
      />
    );

    expect(screen.queryByRole("button", { name: "Sort by Abundance" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sort by Taxon" })).toBeTruthy();
    expect(columnTexts(2)).toEqual(["true", "false", "", "true"]);
    expect(screen.getByRole("button", { name: /Columns/ }).textContent).toContain("1 hidden");

    const sampleToggle = screen.getByRole("checkbox", { name: "Sample" }) as HTMLInputElement;
    expect(sampleToggle.disabled).toBe(true);
    expect(sampleToggle.checked).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Abundance" }));
    expect(onHiddenColumnsChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Taxon" }));
    expect(onHiddenColumnsChange).toHaveBeenLastCalledWith(["abundance", "taxon"]);
    // Controlled: the grid waits for the parent to apply the change.
    expect(screen.getByRole("button", { name: "Sort by Taxon" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onHiddenColumnsChange).toHaveBeenLastCalledWith([]);
  });

  it("manages column visibility itself when uncontrolled", () => {
    render(<DataGrid columns={columns} rows={rows} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Taxon" }));
    expect(screen.queryByRole("button", { name: "Sort by Taxon" })).toBeNull();
    expect(columnTexts(1)).toEqual(["12.5", "0.123457", "", "3"]);

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("button", { name: "Sort by Taxon" })).toBeTruthy();
  });

  it("sorts a numeric column with empty values last and cycles back to the source order", () => {
    render(<DataGrid columns={columns} rows={rows} />);

    const sortAbundance = screen.getByRole("button", { name: "Sort by Abundance" });
    fireEvent.click(sortAbundance);
    expect(headerCell("Abundance").getAttribute("aria-sort")).toBe("ascending");
    expect(columnTexts(0)).toEqual(["S2", "S4", "S1", "S3"]);

    fireEvent.click(sortAbundance);
    expect(headerCell("Abundance").getAttribute("aria-sort")).toBe("descending");
    expect(columnTexts(0)).toEqual(["S1", "S4", "S2", "S3"]);

    fireEvent.click(sortAbundance);
    expect(headerCell("Abundance").getAttribute("aria-sort")).toBe("none");
    expect(columnTexts(0)).toEqual(["S1", "S2", "S3", "S4"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Taxon" }));
    expect(columnTexts(0)).toEqual(["S4", "S2", "S1", "S3"]);
    expect(headerCell("Abundance").getAttribute("aria-sort")).toBe("none");
  });

  it("filters rows by free text across visible cells", () => {
    const { rerender } = render(<DataGrid columns={columns} rows={rows} />);

    const input = screen.getByRole("textbox", { name: "Filter rows" });
    fireEvent.change(input, { target: { value: "BACTER" } });
    expect(columnTexts(0)).toEqual(["S2"]);
    expect(screen.getByText("1 of 4 rows match")).toBeTruthy();

    fireEvent.change(input, { target: { value: "no such taxon" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText(/No rows match/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(columnTexts(0)).toEqual(["S1", "S2", "S3", "S4"]);

    // Hidden columns do not take part in the match.
    rerender(<DataGrid columns={columns} rows={rows} hiddenColumns={["taxon"]} />);
    fireEvent.change(input, { target: { value: "bacter" } });
    expect(screen.getByText(/No rows match/)).toBeTruthy();
  });

  it("commits inline edits cast to the column type", async () => {
    const onCellEdit = vi.fn().mockResolvedValue(undefined);
    render(<DataGrid columns={columns} rows={rows} onCellEdit={onCellEdit} />);

    fireEvent.doubleClick(cell(0, 2));
    const editor = screen.getByRole("textbox", { name: "Edit Abundance" }) as HTMLInputElement;
    expect(editor.value).toBe("12.5");
    expect(document.activeElement).toBe(editor);

    fireEvent.change(editor, { target: { value: "42.5" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(onCellEdit).toHaveBeenCalledWith("r1", "abundance", 42.5));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Edit Abundance" })).toBeNull()
    );
    expect(document.activeElement).toBe(cell(0, 2));

    fireEvent.doubleClick(cell(0, 1));
    const taxonEditor = screen.getByRole("textbox", { name: "Edit Taxon" });
    fireEvent.change(taxonEditor, { target: { value: "   " } });
    fireEvent.keyDown(taxonEditor, { key: "Enter" });
    await waitFor(() => expect(onCellEdit).toHaveBeenCalledWith("r1", "taxon", null));
    expect(onCellEdit).toHaveBeenCalledTimes(2);
  });

  it("does not open an editor for cells without an edit handler", () => {
    render(<DataGrid columns={columns} rows={rows} />);

    fireEvent.doubleClick(cell(0, 1));
    expect(screen.queryByRole("textbox", { name: "Edit Taxon" })).toBeNull();
    fireEvent.keyDown(cell(0, 1), { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "Edit Taxon" })).toBeNull();
  });

  it("cancels an edit with Escape and returns focus to the cell", async () => {
    const onCellEdit = vi.fn().mockResolvedValue(undefined);
    render(<DataGrid columns={columns} rows={rows} onCellEdit={onCellEdit} />);

    fireEvent.doubleClick(cell(0, 1));
    const editor = screen.getByRole("textbox", { name: "Edit Taxon" });
    fireEvent.change(editor, { target: { value: "changed" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit Taxon" })).toBeNull());
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(cell(0, 1).textContent).toBe("Escherichia coli");
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it("keeps the editor open with the old value when the edit is rejected or invalid", async () => {
    const onCellEdit = vi.fn().mockRejectedValue(new Error("Not allowed"));
    render(<DataGrid columns={columns} rows={rows} onCellEdit={onCellEdit} />);

    fireEvent.doubleClick(cell(0, 2));
    const editor = screen.getByRole("textbox", { name: "Edit Abundance" }) as HTMLInputElement;
    fireEvent.change(editor, { target: { value: "99" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(onCellEdit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(editor.value).toBe("12.5"));
    expect(screen.getByRole("textbox", { name: "Edit Abundance" })).toBe(editor);
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(editor.getAttribute("title")).toBe("Not allowed");

    fireEvent.change(editor, { target: { value: "not a number" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onCellEdit).toHaveBeenCalledTimes(1);
    expect(editor.getAttribute("title")).toBe("Enter a number");
    expect(screen.getByRole("textbox", { name: "Edit Abundance" })).toBe(editor);
  });

  it("commits with Tab and moves to the next editable cell in the row", async () => {
    const onCellEdit = vi.fn().mockResolvedValue(undefined);
    render(<DataGrid columns={columns} rows={rows} onCellEdit={onCellEdit} />);

    fireEvent.doubleClick(cell(0, 1));
    const editor = screen.getByRole("textbox", { name: "Edit Taxon" });
    fireEvent.change(editor, { target: { value: "E. coli" } });
    fireEvent.keyDown(editor, { key: "Tab" });

    await waitFor(() => expect(onCellEdit).toHaveBeenCalledWith("r1", "taxon", "E. coli"));
    const next = (await screen.findByRole("textbox", { name: "Edit Abundance" })) as HTMLInputElement;
    expect(next.value).toBe("12.5");

    // No editable cell follows Abundance in the row, so Tab closes the editor;
    // the unchanged value is not committed again.
    fireEvent.keyDown(next, { key: "Tab" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Edit Abundance" })).toBeNull()
    );
    expect(onCellEdit).toHaveBeenCalledTimes(1);
  });

  it("marks excluded rows, shows flags and routes row actions", () => {
    const onRowAction = vi.fn();
    render(<DataGrid columns={columns} rows={rows} onRowAction={onRowAction} />);

    const excludedRow = bodyRows()[2];
    expect(excludedRow.getAttribute("data-excluded")).toBe("true");
    expect(excludedRow.className).toContain("text-muted-foreground");
    expect(bodyRows()[0].className).not.toContain("text-muted-foreground");
    expect(within(excludedRow).getByText("Excluded")).toBeTruthy();
    expect(within(excludedRow).getByText('Lactobacillus, "reuteri"').className).toContain(
      "line-through"
    );
    expect(cell(2, 1).getAttribute("title")).toBe("Edited value");
    expect(cell(0, 1).getAttribute("title")).toBeNull();

    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    expect(restoreButtons).toHaveLength(1);
    fireEvent.click(restoreButtons[0]);
    expect(onRowAction).toHaveBeenCalledWith("r3", "restore");

    expect(screen.getAllByRole("button", { name: "Exclude" })).toHaveLength(3);
    fireEvent.click(within(bodyRows()[0]).getByRole("button", { name: "Exclude" }));
    expect(onRowAction).toHaveBeenCalledWith("r1", "exclude");
    fireEvent.click(within(bodyRows()[1]).getByRole("button", { name: "Flag" }));
    expect(onRowAction).toHaveBeenCalledWith("r2", "flag");
    expect(screen.getByRole("button", { name: "Row actions for S1" })).toBeTruthy();
  });

  it("exports the current view as UTF-8 CSV with a BOM", async () => {
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        hiddenColumns={["passed"]}
        exportFileName="view.csv"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by Abundance" }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = mocks.createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8;");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.subarray(3));
    expect(text).toBe(
      [
        "Sample,Taxon,Abundance",
        "S2,Bacteroides fragilis,0.123456789",
        "S4,Akkermansia muciniphila,3",
        "S1,Escherichia coli,12.5",
        'S3,"Lactobacillus, ""reuteri""",',
      ].join("\r\n")
    );

    expect(mocks.anchorClick).toHaveBeenCalledTimes(1);
    const anchor = mocks.anchorClick.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("view.csv");
    expect(anchor.getAttribute("href")).toBe("blob:seqdesk-grid");
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:seqdesk-grid");
  });

  it("renders skeleton rows while loading and the empty text without rows", () => {
    const { container, rerender } = render(<DataGrid columns={columns} rows={[]} loading />);

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(6);
    expect((screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled).toBe(
      true
    );

    rerender(<DataGrid columns={columns} rows={[]} emptyText="This dataset has no rows." />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    expect(screen.getByText("This dataset has no rows.")).toBeTruthy();
    expect(screen.getByText("0 rows")).toBeTruthy();
  });

  it("moves focus between cells with the keyboard and opens the editor from a cell", () => {
    const onCellEdit = vi.fn();
    render(<DataGrid columns={columns} rows={rows} onCellEdit={onCellEdit} />);

    const first = cell(0, 0);
    expect(first.tabIndex).toBe(0);
    expect(cell(0, 1).tabIndex).toBe(-1);

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(0, 1));
    fireEvent.keyDown(cell(0, 1), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(1, 1));
    fireEvent.keyDown(cell(1, 1), { key: "End" });
    expect(document.activeElement).toBe(cell(1, 3));
    fireEvent.keyDown(cell(1, 3), { key: "Home" });
    expect(document.activeElement).toBe(cell(1, 0));
    fireEvent.keyDown(cell(1, 0), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell(0, 0));
    fireEvent.keyDown(cell(0, 0), { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell(0, 0));
    expect(cell(0, 0).tabIndex).toBe(0);
    expect(cell(1, 0).tabIndex).toBe(-1);

    // Sample is not editable; Enter does nothing there.
    fireEvent.keyDown(cell(0, 0), { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "Edit Sample" })).toBeNull();

    fireEvent.keyDown(cell(0, 0), { key: "ArrowRight" });
    fireEvent.keyDown(cell(0, 1), { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Edit Taxon" }) as HTMLInputElement;
    expect(editor.value).toBe("Escherichia coli");
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: "Escape" });

    // Typing a character starts editing with that character.
    fireEvent.keyDown(cell(0, 2), { key: "7" });
    expect((screen.getByRole("textbox", { name: "Edit Abundance" }) as HTMLInputElement).value).toBe(
      "7"
    );
  });

  it("shows the page counter and a load-more control", () => {
    const onLoadMore = vi.fn();
    render(<DataGrid columns={columns} rows={rows} total={14316} hasMore onLoadMore={onLoadMore} />);

    expect(screen.getByText("showing 4 of 14,316")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more rows" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("toggles row density", () => {
    const onDensityChange = vi.fn();
    const { container } = render(
      <DataGrid columns={columns} rows={rows} density="comfortable" onDensityChange={onDensityChange} />
    );

    const compact = screen.getByRole("button", { name: "Compact" });
    expect(compact.getAttribute("aria-pressed")).toBe("false");
    expect(cell(0, 0).className).toContain("py-1.5");

    fireEvent.click(compact);
    expect(compact.getAttribute("aria-pressed")).toBe("true");
    expect(onDensityChange).toHaveBeenCalledWith("compact");
    expect(container.firstElementChild?.getAttribute("data-density")).toBe("compact");
    expect(cell(0, 0).className).toContain("py-0.5");
  });
});
