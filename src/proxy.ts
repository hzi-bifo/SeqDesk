import { NextResponse, type NextRequest } from "next/server";

import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { isRouteAvailableInDeploymentProfile } from "@/lib/deployment-profile";
import { inputModuleEnabled, isFacilityDataContainer } from "@/lib/modules/input-modules.server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const deploymentProfile = getServerDeploymentProfile();

  // Retire the old higher-level input path; raw file upload needs its own
  // validated input module and must not reuse the genome-archive uploader.
  if (pathname === "/api/workbench/uploads" && request.method === "POST") {
    return NextResponse.json({ error: "Raw-read upload is not enabled; genome/archive uploads are no longer an input module" }, { status: 403 });
  }
  const facilityWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method) && (
    /^\/api\/orders\/[^/]+\/(?:sequencing|stream|files)(?:\/|$)/.test(pathname) ||
    /^\/api\/(?:sequencing-runs|admin\/minknow)(?:\/|$)/.test(pathname)
  );
  if (facilityWrite && !await inputModuleEnabled("sequencing-management")) {
    return NextResponse.json({ error: "Sequencing management is disabled" }, { status: 403 });
  }
  const facilityOrderId = facilityWrite ? /^\/api\/orders\/([^/]+)\//.exec(pathname)?.[1] : undefined;
  if (facilityOrderId && !await isFacilityDataContainer(facilityOrderId)) {
    return NextResponse.json({ error: "Facility actions require a facility sequencing order" }, { status: 403 });
  }

  if (!isRouteAvailableInDeploymentProfile(deploymentProfile, pathname)) {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const url = request.nextUrl.clone();
    url.pathname = deploymentProfile.defaultRoute;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/workbench",
    "/api/workbench/:path*",
    "/api/orders/:path*",
    "/api/sequencing-runs/:path*",
    "/api/studies/:path*",
    "/api/samples/:path*",
    "/api/files/:path*",
    "/api/assemblies/:path*",
    "/api/sidebar/:path*",
    "/api/notes/mentions/:path*",
    "/api/tickets/:path*",
    "/api/form-schema/:path*",
    "/api/study-form-schema/:path*",
    "/api/sequencing-tech/:path*",
    "/api/mixs-checklists/:path*",
    "/api/mixs-templates/:path*",
    "/api/departments/:path*",
    "/api/admin/departments/:path*",
    "/api/admin/field-templates/:path*",
    "/api/admin/form-config/:path*",
    "/api/admin/minknow/:path*",
    "/api/admin/mixs-checklists/:path*",
    "/api/admin/sequencing-run-form-config/:path*",
    "/api/admin/sequencing-tech/:path*",
    "/api/admin/study-definitions/:path*",
    "/api/admin/study-form-config/:path*",
    "/api/admin/submissions/:path*",
    "/api/admin/seed/dummy-data/:path*",
    "/api/admin/settings/ena/:path*",
    "/api/admin/settings/minknow/:path*",
    "/api/admin/settings/sequencing-files/:path*",
    "/admin",
    "/admin/:path*",
    "/analysis",
    "/analysis/:path*",
    "/assemblies",
    "/assemblies/:path*",
    "/help",
    "/messages",
    "/messages/:path*",
    "/orders",
    "/orders/:path*",
    "/settings",
    "/settings/:path*",
    "/studies",
    "/studies/:path*",
    "/submissions",
    "/submissions/:path*",
  ],
};
