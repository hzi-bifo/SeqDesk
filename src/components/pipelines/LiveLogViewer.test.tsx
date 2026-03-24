// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSWR: vi.fn(),
  mutateOutput: vi.fn(),
  mutateError: vi.fn(),
  writeText: vi.fn(),
  createObjectURL: vi.fn(() => "blob:seqdesk-log"),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
}));

vi.mock("swr", () => ({
  default: mocks.useSWR,
}));

vi.mock("@/components/ui/tabs", async () => {
  const ReactModule = await import("react");
  const TabsContext = ReactModule.createContext<{
    value: string;
    onValueChange: (value: string) => void;
  }>({
    value: "",
    onValueChange: () => {},
  });

  return {
    Tabs: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        {children}
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const context = ReactModule.useContext(TabsContext);
      return (
        <button
          role="tab"
          aria-selected={context.value === value}
          onClick={() => context.onValueChange(value)}
          type="button"
        >
          {children}
        </button>
      );
    },
  };
});

import { LiveLogViewer } from "./LiveLogViewer";

describe("LiveLogViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useSWR.mockImplementation((url: string) => {
      if (url.includes("type=output")) {
        return {
          data: {
            content: "stdout line 1\nstdout line 2",
            steps: [
              { process: "ALIGN_READS", status: "running", tasks: 2 },
              { process: "REPORT", status: "completed", tasks: 1 },
            ],
          },
          mutate: mocks.mutateOutput,
        };
      }
      return {
        data: {
          content: "stderr line 1",
        },
        mutate: mocks.mutateError,
      };
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: mocks.writeText,
      },
    });

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

  it("renders an empty state when neither output nor error logs are available", () => {
    mocks.useSWR.mockImplementation((url: string) => ({
      data: url.includes("type=output")
        ? { content: "", steps: [] }
        : { content: "" },
      mutate: vi.fn(),
    }));

    render(<LiveLogViewer runId="run-1" isRunning={false} />);

    expect(screen.getByText("No log output available yet")).toBeTruthy();
  });

  it("shows steps, notifies the parent, and refreshes both log streams", async () => {
    const onStepsUpdate = vi.fn();
    const { container } = render(
      <LiveLogViewer runId="run-1" isRunning onStepsUpdate={onStepsUpdate} />
    );

    await waitFor(() => {
      expect(onStepsUpdate).toHaveBeenCalledWith([
        { process: "ALIGN_READS", status: "running", tasks: 2 },
        { process: "REPORT", status: "completed", tasks: 1 },
      ]);
    });

    expect(screen.getByText("Auto-refreshing...")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Steps/ }));

    await waitFor(() => {
      expect(screen.getByText("ALIGN_READS")).toBeTruthy();
    });
    expect(screen.getByText("REPORT")).toBeTruthy();
    expect(screen.getByText("2 tasks")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();

    fireEvent.click(container.querySelector('button[title="Refresh"]') as HTMLButtonElement);

    expect(mocks.mutateOutput).toHaveBeenCalled();
    expect(mocks.mutateError).toHaveBeenCalled();
  });

  it("copies log output, toggles auto-scroll, and downloads the active log", async () => {
    const { container } = render(<LiveLogViewer runId="run-2" isRunning={false} />);

    fireEvent.click(
      container.querySelector('button[title="Copy to clipboard"]') as HTMLButtonElement
    );

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith("stdout line 1\nstdout line 2");
    });

    fireEvent.click(
      container.querySelector('button[title="Pause auto-scroll"]') as HTMLButtonElement
    );
    expect(
      container.querySelector('button[title="Resume auto-scroll"]')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Error" }));
    fireEvent.click(
      container.querySelector('button[title="Download"]') as HTMLButtonElement
    );

    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
    expect(mocks.createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(mocks.anchorClick).toHaveBeenCalled();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:seqdesk-log");
  });
});
