import { NextResponse, type NextRequest } from "next/server";

import { isLabAppSurface, isWorkbenchAppSurface } from "@/lib/app-surface";

const LAB_DASHBOARD_PREFIXES = [
  "/admin",
  "/analysis",
  "/assemblies",
  "/help",
  "/messages",
  "/orders",
  "/settings",
  "/studies",
  "/submissions",
];

function isLabDashboardPath(pathname: string): boolean {
  return LAB_DASHBOARD_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isLabAppSurface() && pathname.startsWith("/api/workbench")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (isWorkbenchAppSurface() && isLabDashboardPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/workbench/data";
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
