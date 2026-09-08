// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { language } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeEditor } from "./CodeEditor";

// CodeMirror 6 mounts under jsdom 29 without DOM stubs: it guards its
// ResizeObserver usage and jsdom ships Range support, so these tests drive
// the real editor and inspect its state through EditorView.findFromDOM.

afterEach(() => {
  cleanup();
});

function getView(region: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(region);
  if (!view) throw new Error("No CodeMirror view mounted in the region");
  return view;
}

function getContent(region: HTMLElement): HTMLElement {
  const content = region.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("No .cm-content element rendered");
  return content;
}

describe("CodeEditor", () => {
  it("renders a labelled region with the initial document", () => {
    render(<CodeEditor value={"x = 1\nprint(x)"} language="python" />);

    const region = screen.getByRole("region", { name: "Code" });
    expect(region.getAttribute("data-testid")).toBe("code-editor");
    expect(region.getAttribute("data-language")).toBe("python");
    expect(region.style.height).toBe("420px");
    expect(region.querySelector(".cm-editor")).not.toBeNull();
    expect(getContent(region).textContent).toContain("print(x)");
    expect(getView(region).state.doc.toString()).toBe("x = 1\nprint(x)");
  });

  it("applies height, aria label and className overrides", () => {
    render(<CodeEditor value="" language="python" height="200px" ariaLabel="Analysis code" className="custom-class" />);

    const region = screen.getByRole("region", { name: "Analysis code" });
    expect(region.style.height).toBe("200px");
    expect(region.classList.contains("custom-class")).toBe(true);
  });

  it("loads the Python or R language mode and switches when the prop changes", () => {
    const { rerender } = render(<CodeEditor value="x <- 1" language="python" />);
    const region = screen.getByRole("region", { name: "Code" });
    const view = getView(region);

    expect(view.state.facet(language)?.name).toBe("python");

    rerender(<CodeEditor value="x <- 1" language="r" />);

    expect(getView(region)).toBe(view);
    expect(view.state.facet(language)?.name).toBe("r");
    expect(region.getAttribute("data-language")).toBe("r");
  });

  it("starts in R mode when requested", () => {
    render(<CodeEditor value="x <- 1" language="r" />);
    const view = getView(screen.getByRole("region", { name: "Code" }));

    expect(view.state.facet(language)?.name).toBe("r");
  });

  it("is editable by default and becomes read-only when the prop toggles", () => {
    const { rerender } = render(<CodeEditor value="x = 1" language="python" />);
    const region = screen.getByRole("region", { name: "Code" });
    const view = getView(region);

    expect(view.state.readOnly).toBe(false);
    expect(view.state.facet(EditorView.editable)).toBe(true);
    expect(getContent(region).getAttribute("contenteditable")).toBe("true");
    expect(region.getAttribute("data-readonly")).toBeNull();

    rerender(<CodeEditor value="x = 1" language="python" readOnly />);

    expect(view.state.readOnly).toBe(true);
    expect(view.state.facet(EditorView.editable)).toBe(false);
    expect(getContent(region).getAttribute("contenteditable")).toBe("false");
    expect(region.getAttribute("data-readonly")).toBe("true");

    rerender(<CodeEditor value="x = 1" language="python" readOnly={false} />);

    expect(view.state.readOnly).toBe(false);
    expect(getContent(region).getAttribute("contenteditable")).toBe("true");
  });

  it("mounts read-only from the start", () => {
    render(<CodeEditor value="x = 1" language="python" readOnly />);
    const region = screen.getByRole("region", { name: "Code" });

    expect(getView(region).state.readOnly).toBe(true);
    expect(getContent(region).getAttribute("contenteditable")).toBe("false");
  });

  it("calls onChange with the full document when the user edits", () => {
    const onChange = vi.fn();
    render(<CodeEditor value={"x = 1\nprint(x)"} language="python" onChange={onChange} />);
    const view = getView(screen.getByRole("region", { name: "Code" }));

    view.dispatch({ changes: { from: 0, insert: "# header\n" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("# header\nx = 1\nprint(x)");

    view.dispatch({ selection: { anchor: 2 } });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("uses the latest onChange handler without recreating the view", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<CodeEditor value="x = 1" language="python" onChange={first} />);
    const region = screen.getByRole("region", { name: "Code" });
    const view = getView(region);

    rerender(<CodeEditor value="x = 1" language="python" onChange={second} />);
    view.dispatch({ changes: { from: 5, insert: "0" } });

    expect(getView(region)).toBe(view);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("x = 10");
  });

  it("replaces the document on external value changes, keeps the cursor and does not echo onChange", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CodeEditor value={"x = 1\nprint(x)"} language="python" onChange={onChange} />);
    const view = getView(screen.getByRole("region", { name: "Code" }));
    view.dispatch({ selection: { anchor: 4 } });

    rerender(<CodeEditor value={"y = 22\nprint(y)"} language="python" onChange={onChange} />);

    expect(view.state.doc.toString()).toBe("y = 22\nprint(y)");
    expect(view.state.selection.main.anchor).toBe(4);
    expect(onChange).not.toHaveBeenCalled();

    // A shorter document clamps the cursor to the new length.
    rerender(<CodeEditor value="ab" language="python" onChange={onChange} />);

    expect(view.state.doc.toString()).toBe("ab");
    expect(view.state.selection.main.anchor).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not touch the document when the value prop matches the current text", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CodeEditor value="x = 1" language="python" onChange={onChange} />);
    const view = getView(screen.getByRole("region", { name: "Code" }));

    view.dispatch({ changes: { from: 5, insert: "0" }, selection: { anchor: 3 } });
    expect(onChange).toHaveBeenCalledWith("x = 10");

    // The controlling parent feeds the edited text back as the value prop.
    rerender(<CodeEditor value="x = 10" language="python" onChange={onChange} />);

    expect(view.state.doc.toString()).toBe("x = 10");
    expect(view.state.selection.main.anchor).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("toggles line wrapping through the prop", () => {
    const { rerender } = render(<CodeEditor value="x = 1" language="python" />);
    const region = screen.getByRole("region", { name: "Code" });

    expect(getContent(region).classList.contains("cm-lineWrapping")).toBe(false);

    rerender(<CodeEditor value="x = 1" language="python" lineWrapping />);

    expect(getContent(region).classList.contains("cm-lineWrapping")).toBe(true);

    rerender(<CodeEditor value="x = 1" language="python" lineWrapping={false} />);

    expect(getContent(region).classList.contains("cm-lineWrapping")).toBe(false);
  });

  it("mounts with line wrapping enabled", () => {
    render(<CodeEditor value="x = 1" language="python" lineWrapping />);

    expect(getContent(screen.getByRole("region", { name: "Code" })).classList.contains("cm-lineWrapping")).toBe(true);
  });

  it("destroys the view on unmount", () => {
    const { unmount } = render(<CodeEditor value="x = 1" language="python" />);
    const region = screen.getByRole("region", { name: "Code" });
    expect(region.querySelector(".cm-editor")).not.toBeNull();

    unmount();

    expect(region.querySelector(".cm-editor")).toBeNull();
    expect(EditorView.findFromDOM(region)).toBeNull();
  });
});
