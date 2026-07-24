import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens } from "@/lib/google";
import { syncTeacherCalendar } from "@/lib/calendar-sync";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/settings?google=error`);
  }

  const jar = await cookies();
  const expected = jar.get("google_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(`${base}/settings?google=state_mismatch`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokens.id_token.split(".")[1] ?? "", "base64url").toString("utf8"),
        ) as { email?: string };
        email = payload.email ?? null;
      } catch {
        email = null;
      }
    }

    await prisma.teacher.update({
      where: { id: state },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token ?? undefined,
        googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
        googleConnectedEmail: email,
      },
    });

    jar.delete("google_oauth_state");

    try {
      await syncTeacherCalendar(state);
    } catch (syncErr) {
      console.error("Initial calendar sync failed", syncErr);
    }

    return NextResponse.redirect(`${base}/calendar?synced=1`);
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(`${base}/settings?google=token_failed`);
  }
}
