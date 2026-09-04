// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { language } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CodeDiff } from "./CodeDiff";

// The real @codemirror/merge MergeView mounts under jsdom 29 without DOM
// stubs, so the tests inspect the two live pane states directly.

afterEach(() => {
  cleanup();
});

function getPaneViews(region: HTMLElement): EditorView[] {
  return Array.from(region.querySelectorAll<HTMLElement>(".cm-editor")).map((editor) => {
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("No CodeMirror view mounted for a merge pane");
    return view;
  });
}

const ORIGINAL = "a <- 1\nb <- 2\nprint(a + b)\n";
const MODIFIED = "a <- 1\nb <- 3\nprint(a + b)\n";

describe("CodeDiff", () => {
  it("renders the default pane labels and a labelled region", () => {
    render(<CodeDiff original={ORIGINAL} modified={MODIFIED} language="r" />);

    expect(screen.getByTestId("code-diff-label-a").textContent).toBe("Revision A");
    expect(screen.getByTestId("code-diff-label-b").textContent).toBe("Revision B");
    const region = screen.getByRole("region", { name: "Code comparison: Revision A versus Revision B" });
    expect(region.style.height).toBe("420px");
    expect(screen.getByTestId("code-diff").getAttribute("data-language")).toBe("r");
  });

  it("renders custom labels, height and className", () => {
    render(
      <CodeDiff
        original={ORIGINAL}
        modified={MODIFIED}
        language="python"
        labels={["Revision 3", "Revision 4"]}
        height="240px"
        className="custom-diff"
      />
    );

    expect(screen.getByTestId("code-diff-label-a").textContent).toBe("Revision 3");
    expect(screen.getByTestId("code-diff-label-b").textContent).toBe("Revision 4");
    expect(screen.getByRole("region", { name: "Code comparison: Revision 3 versus Revision 4" }).style.height).toBe("240px");
    expect(screen.getByTestId("code-diff").classList.contains("custom-diff")).toBe(true);
  });

  it("mounts a side-by-side merge view with both documents", () => {
    render(<CodeDiff original={ORIGINAL} modified={MODIFIED} language="r" />);
    const region = screen.getByRole("region");

    const mergeView = region.querySelector<HTMLElement>(".cm-mergeView");
    expect(mergeView).not.toBeNull();
    expect(mergeView?.style.height).toBe("100%");
    expect(mergeView?.style.overflow).toBe("auto");

    const [a, b] = getPaneViews(region);
    expect(a.state.doc.toString()).toBe(ORIGINAL);
    expect(b.state.doc.toString()).toBe(MODIFIED);
    expect(region.querySelector(".cm-changedLine")).not.toBeNull();
  });

  it("keeps both panes read-only", () => {
    render(<CodeDiff original={ORIGINAL} modified={MODIFIED} language="r" />);
    const panes = getPaneViews(screen.getByRole("region"));

    expect(panes).toHaveLength(2);
    for (const pane of panes) {
      expect(pane.state.readOnly).toBe(true);
      expect(pane.state.facet(EditorView.editable)).toBe(false);
      expect(pane.contentDOM.getAttribute("contenteditable")).toBe("false");
    }
  });

  it("uses the requested language mode in both panes", () => {
    const { rerender } = render(<CodeDiff original="x = 1" modified="x = 2" language="python" />);
    const region = screen.getByRole("region");

    for (const pane of getPaneViews(region)) {
      expect(pane.state.facet(language)?.name).toBe("python");
    }

    rerender(<CodeDiff original="x = 1" modified="x = 2" language="r" />);

    for (const pane of getPaneViews(region)) {
      expect(pane.state.facet(language)?.name).toBe("r");
    }
  });

  it("rebuilds the view when the compared revisions change", () => {
    const { rerender } = render(<CodeDiff original={ORIGINAL} modified={MODIFIED} language="r" />);
    const region = screen.getByRole("region");
    const [, before] = getPaneViews(region);

    rerender(<CodeDiff original={ORIGINAL} modified={"a <- 1\nb <- 4\n"} language="r" />);

    expect(region.querySelectorAll(".cm-mergeView")).toHaveLength(1);
    const [a, after] = getPaneViews(region);
    expect(after).not.toBe(before);
    expect(a.state.doc.toString()).toBe(ORIGINAL);
    expect(after.state.doc.toString()).toBe("a <- 1\nb <- 4\n");
  });

  it("destroys the merge view on unmount", () => {
    const { unmount } = render(<CodeDiff original={ORIGINAL} modified={MODIFIED} language="r" />);
    const region = screen.getByRole("region");
    expect(region.querySelector(".cm-mergeView")).not.toBeNull();

    unmount();

    expect(region.querySelector(".cm-mergeView")).toBeNull();
  });
});
