import { redirect } from "next/navigation";

export default async function LegacyAdminRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = rawCode?.trim();
  redirect(code ? `/register?code=${encodeURIComponent(code)}` : "/register");
}
