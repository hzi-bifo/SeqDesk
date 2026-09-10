import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ExploreAuthorizationError, requireTargetAccess } from "@/lib/explore/authorization";
import { FileLibraryError, getLibraryFile } from "@/lib/files/library";

export async function requireFileSession(write = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new FileLibraryError(401, "Unauthorized");
  if (write && session.user.isDemo) throw new FileLibraryError(403, "Uploads are disabled in the public demo.");
  return session;
}

export async function loadAccessibleFile(id: string) {
  const session = await requireFileSession();
  const file = await getLibraryFile(id);
  await requireTargetAccess(session, file.targetKey, "read");
  return file;
}

export function fileErrorResponse(error: unknown) {
  if (error instanceof FileLibraryError || error instanceof ExploreAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[file-library] unexpected error", error);
  return NextResponse.json({ error: "Could not access Files. Please try again." }, { status: 500 });
}
