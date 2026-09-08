import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { db } from "@/lib/db";
import { SequencingApiError } from "@/lib/sequencing/server";
export async function requireOrderPipelineAccess(orderId: string, mutate = false) {
  const session = await getServerSession(authOptions);
  const decision = decideCapability(session, "analysis.run", getServerDeploymentProfile());
  if (!decision.allowed || !decision.principal || !session) throw new SequencingApiError(decision.status, "Pipeline access denied");
  if (mutate && session.user.isDemo) throw new SequencingApiError(403, "Pipeline changes are disabled in the public demo");
  const where = { id: orderId, ...(decision.grant?.scope === "installation" ? {} : { userId: decision.principal.id }) };
  const order = await db.order.findFirst({ where, select: { id: true, dataOrigin: true } });
  if (!order) throw new SequencingApiError(404, "Sequencing data not found");
  return { session, order, where };
}
