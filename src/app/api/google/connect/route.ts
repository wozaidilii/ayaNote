import { redirect } from "next/navigation";
import {
  buildGoogleAuthUrl,
  googleConfigured,
  signGoogleConnectState,
} from "@/lib/google";
import { requireTeacher } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const teacher = await requireTeacher();
  if (!googleConfigured()) {
    redirect("/calendar?err=google_not_configured");
  }
  const state = await signGoogleConnectState(teacher.id);
  redirect(buildGoogleAuthUrl(state));
}
