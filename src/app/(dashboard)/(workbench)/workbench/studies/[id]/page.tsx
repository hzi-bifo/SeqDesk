import { redirect } from "next/navigation";

export default async function ImportedStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/studies/${encodeURIComponent(id)}`);
}
