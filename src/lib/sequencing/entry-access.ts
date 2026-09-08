import type { Prisma } from "@prisma/client";

/** Imported entries inherit study ownership; facility entries inherit order ownership. */
export function sequencingEntryScope(userId: string, installation = false): Prisma.SampleWhereInput {
  return installation ? {} : { OR: [
    { order: { userId } },
    { orderId: null, study: { userId } },
  ] };
}
