import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildGoogleAuthUrl, googleConfigured } from "@/lib/google";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";

export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?google=missing_creds", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    );
  }

  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
  const jar = await cookies();
  jar.set("google_oauth_state", teacher.id, { path: "/", httpOnly: true, maxAge: 600 });

  return NextResponse.redirect(buildGoogleAuthUrl(teacher.id));
}
