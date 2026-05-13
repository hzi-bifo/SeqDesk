import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import OrderPipelinesRedirectPage from "./page";

describe("/orders/[id]/pipelines", () => {
  it("redirects the old overview route to sequencing analysis", async () => {
    await expect(
      OrderPipelinesRedirectPage({
        params: Promise.resolve({ id: "order-1" }),
      })
    ).rejects.toThrow("redirect:/orders/order-1/sequencing?view=analysis");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/orders/order-1/sequencing?view=analysis"
    );
  });

  it("preserves a requested pipeline as a sequencing pipeline route", async () => {
    await expect(
      OrderPipelinesRedirectPage({
        params: Promise.resolve({ id: "order-1" }),
        searchParams: Promise.resolve({ pipeline: "simulate-reads" }),
      })
    ).rejects.toThrow(
      "redirect:/orders/order-1/sequencing?pipeline=simulate-reads"
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/orders/order-1/sequencing?pipeline=simulate-reads"
    );
  });
});
