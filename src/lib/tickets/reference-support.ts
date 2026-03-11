import { db } from "@/lib/db";

type TableInfoRow = {
  name: string;
};

let ticketReferenceSupportPromise: Promise<boolean> | null = null;

async function detectTicketReferenceSupport(): Promise<boolean> {
  try {
    const columns = await db.$queryRawUnsafe<TableInfoRow[]>(
      `
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Ticket'
          AND column_name IN ('orderId', 'studyId')
      `
    );
    const columnNames = new Set(columns.map((column) => column.name));
    return columnNames.has("orderId") && columnNames.has("studyId");
  } catch {
    return false;
  }
}

export async function ticketReferencesSupported(): Promise<boolean> {
  if (!ticketReferenceSupportPromise) {
    ticketReferenceSupportPromise = detectTicketReferenceSupport();
  }
  return ticketReferenceSupportPromise;
}
