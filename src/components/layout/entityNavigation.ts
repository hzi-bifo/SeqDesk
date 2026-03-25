interface SearchParamsLike {
  get(name: string): string | null;
}

function mapStudySectionToTab(section: string | null): string | null {
  switch (section) {
    case "samples":
    case "reads":
      return section;
    case "analysis":
      return "pipelines";
    case "archive":
      return "publishing";
    default:
      return null;
  }
}

function normalizeStudyTab(tab: string | null): string | null {
  switch (tab) {
    case "samples":
    case "reads":
    case "pipelines":
    case "publishing":
      return tab;
    case "ena":
      return "publishing";
    default:
      return null;
  }
}

export function getStudyHref(
  studyId: string | null,
  pathname: string,
  searchParams: SearchParamsLike,
): string {
  if (!studyId) {
    return "/studies";
  }

  const studySubview = pathname.match(/^\/studies\/[^/]+\/(edit|metadata|facility)$/)?.[1];
  if (studySubview) {
    if (studySubview === "facility") {
      const subsection = searchParams.get("subsection");
      return subsection
        ? `/studies/${studyId}/facility?subsection=${subsection}`
        : `/studies/${studyId}/facility`;
    }
    return `/studies/${studyId}/${studySubview}`;
  }

  const activeTab =
    normalizeStudyTab(searchParams.get("tab")) ??
    mapStudySectionToTab(searchParams.get("section"));
  if (!activeTab || activeTab === "overview") {
    return `/studies/${studyId}`;
  }

  const nextSearchParams = new URLSearchParams();
  nextSearchParams.set("tab", activeTab);

  if (activeTab === "pipelines") {
    const pipelineId = searchParams.get("pipeline");
    if (pipelineId) {
      nextSearchParams.set("pipeline", pipelineId);
    }
  }

  if (activeTab === "publishing") {
    const publisher =
      searchParams.get("publisher") ??
      (searchParams.get("tab") === "ena" ? "ena" : null);
    if (publisher) {
      nextSearchParams.set("publisher", publisher);
    }
  }

  return `/studies/${studyId}?${nextSearchParams.toString()}`;
}

export function getOrderHref(
  orderId: string | null,
  pathname: string,
  searchParams: SearchParamsLike,
): string {
  if (!orderId) {
    return "/orders";
  }

  const orderSubview = pathname.match(/^\/orders\/[^/]+\/(edit|files|sequencing|studies)$/)?.[1];
  if (orderSubview === "edit") {
    const step = searchParams.get("step");
    const scope = searchParams.get("scope");
    if (step) {
      return scope
        ? `/orders/${orderId}/edit?step=${step}&scope=${scope}`
        : `/orders/${orderId}/edit?step=${step}`;
    }
    return scope ? `/orders/${orderId}/edit?scope=${scope}` : `/orders/${orderId}/edit`;
  }

  if (orderSubview === "files" || orderSubview === "sequencing" || orderSubview === "studies") {
    return `/orders/${orderId}/${orderSubview}`;
  }

  if (searchParams.get("section") === "reads") {
    return `/orders/${orderId}/sequencing`;
  }

  if (searchParams.get("section") === "facility") {
    const subsection = searchParams.get("subsection");
    return subsection
      ? `/orders/${orderId}?section=facility&subsection=${subsection}`
      : `/orders/${orderId}?section=facility`;
  }

  const subsection = searchParams.get("subsection");
  if (subsection) {
    if (subsection === "_facility") {
      return `/orders/${orderId}?section=facility`;
    }
    return `/orders/${orderId}?subsection=${subsection}`;
  }

  return `/orders/${orderId}`;
}
