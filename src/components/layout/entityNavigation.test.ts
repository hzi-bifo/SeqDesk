import { describe, expect, it } from "vitest";

import { getOrderHref, getStudyHref } from "./entityNavigation";

describe("getStudyHref", () => {
  it("returns the studies list when no study id is selected", () => {
    expect(getStudyHref(null, "/studies", new URLSearchParams())).toBe("/studies");
  });

  it("preserves facility subsections for study facility pages", () => {
    expect(
      getStudyHref("study-1", "/studies/study-1/facility", new URLSearchParams("subsection=qc"))
    ).toBe("/studies/study-1/facility?subsection=qc");
  });

  it("keeps explicit edit subviews for studies", () => {
    expect(getStudyHref("study-1", "/studies/study-1/edit", new URLSearchParams())).toBe(
      "/studies/study-1/edit"
    );
  });

  it("maps study section aliases to the matching tab", () => {
    expect(getStudyHref("study-1", "/studies/study-1", new URLSearchParams("section=analysis"))).toBe(
      "/studies/study-1?tab=pipelines"
    );
    expect(getStudyHref("study-1", "/studies/study-1", new URLSearchParams("section=archive"))).toBe(
      "/studies/study-1?tab=publishing"
    );
  });

  it("preserves publishing and pipeline sub-routes", () => {
    expect(
      getStudyHref("study-1", "/studies/study-1", new URLSearchParams("tab=publishing&publisher=ena"))
    ).toBe("/studies/study-1?tab=publishing&publisher=ena");
    expect(
      getStudyHref("study-1", "/studies/study-1", new URLSearchParams("tab=ena"))
    ).toBe("/studies/study-1?tab=publishing&publisher=ena");
    expect(
      getStudyHref("study-1", "/studies/study-1", new URLSearchParams("tab=pipelines&pipeline=mag"))
    ).toBe("/studies/study-1?tab=pipelines&pipeline=mag");
  });

  it("drops unknown tabs back to the study overview", () => {
    expect(getStudyHref("study-1", "/studies/study-1", new URLSearchParams("tab=unknown"))).toBe(
      "/studies/study-1"
    );
  });
});

describe("getOrderHref", () => {
  it("returns the orders list when no order id is selected", () => {
    expect(getOrderHref(null, "/orders", new URLSearchParams())).toBe("/orders");
  });

  it("preserves edit step and scope query params", () => {
    expect(
      getOrderHref(
        "order-1",
        "/orders/order-1/edit",
        new URLSearchParams("step=samples&scope=facility")
      )
    ).toBe("/orders/order-1/edit?step=samples&scope=facility");
  });

  it("keeps explicit order subviews", () => {
    expect(getOrderHref("order-1", "/orders/order-1/files", new URLSearchParams())).toBe(
      "/orders/order-1/files"
    );
    expect(getOrderHref("order-1", "/orders/order-1/studies", new URLSearchParams())).toBe(
      "/orders/order-1/studies"
    );
  });

  it("maps read sections to sequencing and preserves facility subsections", () => {
    expect(getOrderHref("order-1", "/orders/order-1", new URLSearchParams("section=reads"))).toBe(
      "/orders/order-1/sequencing"
    );
    expect(
      getOrderHref(
        "order-1",
        "/orders/order-1",
        new URLSearchParams("section=facility&subsection=notes")
      )
    ).toBe("/orders/order-1?section=facility&subsection=notes");
  });

  it("maps subsection aliases to the expected order view", () => {
    expect(getOrderHref("order-1", "/orders/order-1", new URLSearchParams("subsection=_facility"))).toBe(
      "/orders/order-1?section=facility"
    );
    expect(getOrderHref("order-1", "/orders/order-1", new URLSearchParams("subsection=files"))).toBe(
      "/orders/order-1?subsection=files"
    );
  });
});
