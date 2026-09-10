import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";

export default async function LegacyOrderFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!isActiveSession(session)) {
    redirect("/login");
  }

  redirect(`/orders/${id}/samples-files`);
}
