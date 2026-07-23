import { cookies } from "next/headers";

export type AppRole = "teacher" | "student";

export const DEMO_TEACHER_EMAIL = "ayano@ayanote.app";
export const DEMO_STUDENT_EMAIL = "alex@example.com";

export async function getSession() {
  const jar = await cookies();
  const role = (jar.get("ayanote_role")?.value as AppRole | undefined) ?? "teacher";
  const locale = jar.get("ayanote_locale")?.value ?? "ja";
  return { role, locale };
}
