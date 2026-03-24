import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDemoSession } from "@/lib/demo/server";

export class SequencingApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireFacilityAdminSequencingSession(): Promise<Session> {
  const session = await getServerSession(authOptions);

  if (!session) {
    throw new SequencingApiError(401, "Unauthorized");
  }

  if (isDemoSession(session)) {
    throw new SequencingApiError(
      403,
      "Sequencing data management is disabled in the public demo."
    );
  }

  if (session.user.role !== "FACILITY_ADMIN") {
    throw new SequencingApiError(403, "Only facility admins can manage sequencing data");
  }

  return session;
}

/** Read-only variant that allows demo users to view sequencing data. */
export async function requireFacilityAdminSequencingReadSession(): Promise<Session> {
  const session = await getServerSession(authOptions);

  if (!session) {
    throw new SequencingApiError(401, "Unauthorized");
  }

  if (session.user.role !== "FACILITY_ADMIN") {
    throw new SequencingApiError(403, "Only facility admins can manage sequencing data");
  }

  return session;
}
