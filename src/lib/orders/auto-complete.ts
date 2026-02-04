import { db } from "@/lib/db";

/**
 * Check if an order should be automatically completed.
 * An order is completed when status is SUBMITTED and every sample has
 * at least one read with file1 assigned.
 */
export async function checkAndCompleteOrder(orderId: string): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      samples: {
        include: { reads: true },
      },
    },
  });

  if (!order || order.status !== "SUBMITTED") {
    return false;
  }

  if (order.samples.length === 0) {
    return false;
  }

  const allSamplesHaveFiles = order.samples.every((sample) =>
    sample.reads.some((read) => read.file1)
  );

  if (!allSamplesHaveFiles) {
    return false;
  }

  await db.order.update({
    where: { id: orderId },
    data: {
      status: "COMPLETED",
      statusUpdatedAt: new Date(),
    },
  });

  await db.statusNote.create({
    data: {
      orderId,
      noteType: "STATUS_CHANGE",
      content:
        "Automatically completed - all samples have sequencing files",
    },
  });

  return true;
}
