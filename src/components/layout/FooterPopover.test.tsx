// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider, useConfirm } from "@/components/ui/confirm-dialog";
import { FooterPopover } from "./FooterPopover";

afterEach(cleanup);

function Harness({ onAction = () => {} }: { onAction?: () => void }) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  return <>
    <button type="button">Outside panel</button>
    <footer style={{ position: "fixed", zIndex: 30 }}>
      <FooterPopover open={open} onOpenChange={setOpen} title="Notifications" width={860}
        trigger={<button type="button">Open notifications</button>}
        actions={<button type="button" onClick={onAction}>Mark all read</button>}>
        <p>{"long-path-without-spaces/".repeat(40)}</p>
        <button type="button" onClick={async () => {
          if (await confirm({ title: "Stop worker?", description: "Confirm this test action.", confirmLabel: "Stop worker" })) onAction();
        }}>Worker action</button>
      </FooterPopover>
    </footer>
  </>;
}

describe("footer popover", () => {
  it("portals an accessible panel out of the footer with a separate bounded scrolling body", () => {
    const { container } = render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open notifications" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Notifications", exact: true });
    expect(container.contains(panel)).toBe(false);
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("data-side")).toBe("top");
    expect(panel.style.maxWidth).toBe("calc(100vw - 16px)");
    expect(panel.style.maxHeight).toContain("--radix-popover-content-available-height");
    const body = within(panel).getByRole("region", { name: "Notifications content" });
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("overscroll-contain");
    expect(body.className).toContain("[overflow-wrap:anywhere]");
    expect(body.contains(within(panel).getByRole("button", { name: "Close notifications" }))).toBe(false);
  });

  it("focuses Close, never an action, and restores the trigger after Escape or Close", async () => {
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    const trigger = screen.getByRole("button", { name: "Open notifications" });
    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Close notifications" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("closes on outside interaction without moving focus away from the user's next control", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close notifications" })));
    const outside = screen.getByRole("button", { name: "Outside panel" });
    // Radix installs its outside-pointer listener after the opening event.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.pointerDown(outside, { pointerType: "mouse", button: 0 });
    act(() => outside.focus());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  it("does not steal focus from a confirmation dialog opened inside the panel", async () => {
    const onAction = vi.fn();
    render(<ConfirmDialogProvider><Harness onAction={onAction} /></ConfirmDialogProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Worker action" }));
    const confirmation = await screen.findByRole("dialog", { name: "Stop worker?", exact: true });
    await waitFor(() => expect(confirmation.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stop worker?" })).toBeNull());
    expect(onAction).not.toHaveBeenCalled();
  });
});
