import { NextResponse, type NextRequest } from "next/server";

import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { isRouteAvailableInDeploymentProfile } from "@/lib/deployment-profile";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const deploymentProfile = getServerDeploymentProfile();

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
