import { NextResponse, type NextRequest } from "next/server";

import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { isRouteAvailableInDeploymentProfile } from "@/lib/deployment-profile";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const deploymentProfile = getServerDeploymentProfile();
  const isWorkbench = deploymentProfile.experience === "workbench";

  if (!isWorkbench && pathname.startsWith("/api/workbench")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isRouteAvailableInDeploymentProfile(deploymentProfile, pathname)) {
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
