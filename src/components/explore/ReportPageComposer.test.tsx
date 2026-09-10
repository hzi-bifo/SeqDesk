// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportPageComposer } from "./ReportPageComposer";
import { MAX_REPORT_BLOCKS, type ReportBlock } from "@/lib/explore/report-blocks";

afterEach(cleanup);
const blocks: ReportBlock[] = [{ id: "a", type: "text", markdown: "A" }, { id: "b", type: "text", markdown: "B", span: 1 }];
function setup(editing = true, disabled = false, items = blocks) {
  const onMove = vi.fn().mockReturnValue(true);
  const onInsert = vi.fn();
  const result = render(<ReportPageComposer blocks={items} editing={editing} disabled={disabled} onMove={onMove} onInsert={onInsert}
    renderBlock={(block, _index, handle) => <section key={block.id} aria-label={block.id}>{handle}<textarea aria-label={`Text ${block.id}`} defaultValue={block.id} /></section>} />);
  return { ...result, onMove, onInsert };
}
const transfer = () => ({ types: ["application/x-seqdesk-report-block"], setData: vi.fn(), effectAllowed: "none", dropEffect: "none" });

describe("visual report page composer", () => {
  it("offers targeted insertion without writing until a type is selected", () => {
    const { onInsert } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add content before block 2" }));
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Chart from a table/ }));
    expect(onInsert).toHaveBeenCalledWith("chart", { blockId: "b", edge: "before" });
  });
  it("works by clicking on empty pages and with a hidden sidebar", () => {
    const { onInsert } = setup(true, false, []);
    fireEvent.click(screen.getByRole("button", { name: "Add the first block" }));
    fireEvent.click(screen.getByRole("button", { name: /Saved data & figures/ }));
    expect(onInsert).toHaveBeenCalledWith("data", null);
  });
  it("moves on drop only and keeps editable text out of the drag handle", () => {
    const { container, onMove } = setup();
    const handle = within(screen.getByRole("region", { name: "a", exact: true })).getByRole("button", { name: "Drag to move block" });
    const target = container.querySelector('[data-report-block-id="b"]')!;
    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 0 });
    expect(screen.getByText("Move here")).toBeTruthy();
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.drop(target, { dataTransfer, clientY: 0 });
    expect(onMove).toHaveBeenCalledWith("a", { blockId: "b", edge: "after" });
    expect(screen.queryByText("Move here")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Text a" }).getAttribute("draggable")).toBeNull();
  });
  it("supports keyboard movement without requiring dragging", () => {
    const { onMove } = setup();
    const handles = screen.getAllByRole("button", { name: "Drag to move block" });
    fireEvent.keyDown(handles[1], { key: "ArrowUp" });
    expect(onMove).toHaveBeenLastCalledWith("b", { blockId: "a", edge: "before" });
    fireEvent.keyDown(handles[0], { key: "ArrowDown" });
    expect(onMove).toHaveBeenLastCalledWith("a", { blockId: "b", edge: "after" });
    fireEvent.keyDown(handles[0], { key: "ArrowUp" });
    expect(onMove).toHaveBeenCalledTimes(2);
  });
  it("accepts a drop on the gap showing the current insertion line", () => {
    const { container, onMove } = setup();
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getAllByRole("button", { name: "Drag to move block" })[0], { dataTransfer });
    fireEvent.dragOver(container.querySelector('[data-report-block-id="b"]')!, { dataTransfer, clientY: 0 });
    fireEvent.drop(container.querySelector('[aria-label="Report layout"]')!, { dataTransfer });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("a", { blockId: "b", edge: "after" });
  });
  it("does not treat file drops as blocks or leave the report to open a dropped file", () => {
    const { container, onMove, onInsert } = setup();
    const allowed = fireEvent.drop(container.querySelector('[aria-label="Report layout"]')!, { dataTransfer: { types: ["Files"] } });
    expect(allowed).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("to import your file");
  });
  it("cancels a drag without saving and ignores fabricated external block payloads", () => {
    const { container, onMove } = setup();
    const handle = screen.getAllByRole("button", { name: "Drag to move block" })[0];
    const target = container.querySelector("[data-report-drop-end]")!;
    const dataTransfer = transfer();
    fireEvent.drop(target, { dataTransfer });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.keyDown(handle, { key: "Escape" });
    fireEvent.drop(target, { dataTransfer });
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("cancelled");
  });
  it("allows rearranging a full page while disabling new blocks", () => {
    setup(true, false, Array.from({ length: MAX_REPORT_BLOCKS }, (_, index): ReportBlock => ({ ...blocks[0], id: String(index) })));
    expect(screen.getByRole("button", { name: "Add content at the end" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Drag to move block" })[0].hasAttribute("disabled")).toBe(false);
  });
  it("does not offer editing controls to readers or permit movement in a conflict", () => {
    const { unmount } = setup(false);
    expect(screen.queryByRole("button", { name: "Drag to move block" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add content at the end" })).toBeNull();
    unmount();
    const { onMove } = setup(true, true);
    const handle = screen.getAllByRole("button", { name: "Drag to move block" })[0];
    expect(handle.getAttribute("draggable")).toBe("false");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onMove).not.toHaveBeenCalled();
  });
});
