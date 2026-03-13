import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

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

  if (session.user.role === "FACILITY_ADMIN" && !session.user.isDemo) {
    redirect(`/orders/${id}/sequencing`);
  }

  redirect(`/orders/${id}`);
}
