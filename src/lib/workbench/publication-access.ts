import type { Prisma } from "@prisma/client";

/** Serialize publication with owner deactivation/transfer and workspace deletion. */
export async function lockWorkbenchPublicationAccess(
  tx: Prisma.TransactionClient, workspaceId: string, userId: string
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT w."id" FROM "WorkbenchWorkspace" w
    JOIN "User" u ON u."id" = w."ownerId"
    WHERE w."id" = ${workspaceId} AND u."id" = ${userId} AND u."isActive" = true
    FOR SHARE OF w, u
  `;
  if (rows.length !== 1) throw new Error("Import destination is no longer available to this user");
}
