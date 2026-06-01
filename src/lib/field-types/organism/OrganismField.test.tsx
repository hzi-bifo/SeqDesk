// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganismField, OrganismCellEditor } from "./OrganismField";

describe("OrganismField", () => {
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

  function getInput(): HTMLInputElement {
    return screen.getByPlaceholderText(
      "e.g., human gut metagenome"
    ) as HTMLInputElement;
  }

  it("renders empty when no value or scientific name is provided", () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    expect(getInput().value).toBe("");
  });

  it("displays the provided scientific name and the taxId badge for an existing value", () => {
    render(
      <OrganismField
        value="9606"
        scientificName="Homo sapiens"
        onChange={vi.fn()}
      />
    );
    expect(getInput().value).toBe("Homo sapiens");
    // taxId badge shows when a value exists.
    expect(screen.getByText("9606")).toBeTruthy();
  });

  it("looks up the scientific name from a known taxId when none is passed", () => {
    render(<OrganismField value="562" onChange={vi.fn()} />);
    expect(getInput().value).toBe("Escherichia coli");
  });

  it("falls back to a TaxID label for an unknown taxId with no scientific name", () => {
    render(<OrganismField value="999999999" onChange={vi.fn()} />);
    expect(getInput().value).toBe("TaxID: 999999999");
  });

  it("opens a results dropdown and selects an entry on click", async () => {
    const onChange = vi.fn();
    render(<OrganismField value="" onChange={onChange} />);

    fireEvent.change(getInput(), { target: { value: "Escherichia" } });

    // Dropdown shows the matching organism.
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();
    expect(screen.getByText("NCBI:562")).toBeTruthy();

    fireEvent.click(screen.getByText("Escherichia coli"));
    expect(onChange).toHaveBeenCalledWith("562", "Escherichia coli");
    // Dropdown closes after selection.
    expect(screen.queryByText("NCBI:562")).toBeNull();
  });

  it("shows the common name in parentheses when present", async () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    fireEvent.change(getInput(), { target: { value: "Homo sapiens" } });
    expect(await screen.findByText("(human)")).toBeTruthy();
  });

  it("does not search for queries shorter than two characters", () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    fireEvent.change(getInput(), { target: { value: "E" } });
    expect(screen.queryByText("Escherichia coli")).toBeNull();
  });

  it("calls onChange with empty strings when the input is cleared", () => {
    const onChange = vi.fn();
    render(
      <OrganismField
        value="9606"
        scientificName="Homo sapiens"
        onChange={onChange}
      />
    );
    fireEvent.change(getInput(), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("", "");
  });

  it("renders a no-results message with an NCBI search link for unmatched queries", async () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    fireEvent.change(getInput(), {
      target: { value: "zzzzzznotataxon" },
    });
    expect(
      await screen.findByText("No matching organisms found.")
    ).toBeTruthy();
    const link = screen.getByText("Search NCBI Taxonomy").closest("a");
    expect(link?.getAttribute("href")).toContain("zzzzzznotataxon");
  });

  it("navigates results with arrow keys and selects with Enter", async () => {
    const onChange = vi.fn();
    render(<OrganismField value="" onChange={onChange} />);

    const input = getInput();
    fireEvent.change(input, { target: { value: "metagenome" } });
    // Multiple organisms match "metagenome"; wait for the result list.
    await screen.findAllByText(/metagenome/);

    // Move highlight down one and select.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [taxId, name] = onChange.mock.calls[0];
    expect(typeof taxId).toBe("string");
    expect(name).toContain("metagenome");
  });

  it("closes the dropdown on Escape", async () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "Escherichia" } });
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Escherichia coli")).toBeNull();
  });

  it("reopens the dropdown on focus when input already has a query", async () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "coli" } });
    await screen.findByText("Escherichia coli");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Escherichia coli")).toBeNull();

    fireEvent.focus(input);
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();
  });

  it("resolves a numeric taxId entry to its organism via the dropdown match", async () => {
    const onChange = vi.fn();
    render(<OrganismField value="" onChange={onChange} />);
    const input = getInput();
    // Typing a known numeric taxId surfaces the matching organism in the
    // dropdown (exact taxId match). handleBlur intentionally skips resolution
    // when the taxId is already present in the results, so the user selects it.
    fireEvent.change(input, { target: { value: "9606" } });
    fireEvent.click(await screen.findByText("Homo sapiens"));

    expect(onChange).toHaveBeenCalledWith("9606", "Homo sapiens");
  });

  it("marks an unknown numeric taxId on blur", () => {
    const onChange = vi.fn();
    render(<OrganismField value="" onChange={onChange} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "123456789" } });
    fireEvent.blur(input);

    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledWith(
      "123456789",
      "Unknown organism (TaxID: 123456789)"
    );
  });

  it("respects the disabled prop", () => {
    render(<OrganismField value="" onChange={vi.fn()} disabled />);
    expect(getInput().disabled).toBe(true);
  });

  it("renders the compact cell editor variant", async () => {
    const onChange = vi.fn();
    render(
      <OrganismCellEditor value="" scientificName="" onChange={onChange} />
    );
    const input = getInput();
    expect(input.className).toContain("h-8");

    fireEvent.change(input, { target: { value: "Escherichia" } });
    fireEvent.click(await screen.findByText("Escherichia coli"));
    expect(onChange).toHaveBeenCalledWith("562", "Escherichia coli");
  });

  it("closes the dropdown when clicking outside", async () => {
    render(<OrganismField value="" onChange={vi.fn()} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "Escherichia" } });
    expect(await screen.findByText("Escherichia coli")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText("Escherichia coli")).toBeNull();
    });
  });
});
