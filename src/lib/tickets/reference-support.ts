import { db } from "@/lib/db";

type TableInfoRow = {
  name: string;
};

let ticketReferenceSupportPromise: Promise<boolean> | null = null;

async function detectTicketReferenceSupport(): Promise<boolean> {
  try {
    const columns = await db.$queryRawUnsafe<TableInfoRow[]>(
      "PRAGMA table_info('Ticket')"
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
