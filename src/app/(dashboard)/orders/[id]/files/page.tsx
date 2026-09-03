import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { decideServerCapability } from "@/lib/authorization/api";

export default async function LegacyOrderFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session) {
    redirect("/login");
  }

  if (
    decideServerCapability(session, "sequencing.files.manage").allowed &&
    !session.user.isDemo
  ) {
    redirect(`/orders/${id}/sequencing`);
  }

  redirect(`/orders/${id}`);
}
