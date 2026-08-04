import { redirect } from "next/navigation";

/** Legacy path — login lives at `/`. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.err ? `?err=${encodeURIComponent(sp.err)}` : "";
  redirect(`/${q}`);
}
