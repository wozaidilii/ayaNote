import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  emailFromGoogleIdToken,
  exchangeCodeForTokens,
  googleConfigured,
  verifyGoogleConnectState,
} from "@/lib/google";

export const runtime = "nodejs";

function calendarRedirect(req: NextRequest, query: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/calendar";
  url.search = `?${query}`;
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return calendarRedirect(req, "err=google_not_configured");
  }

  const url = req.nextUrl;
  const err = url.searchParams.get("error");
  if (err) {
    return calendarRedirect(req, "err=google_denied");
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) {
    return calendarRedirect(req, "err=google_oauth");
  }

  const teacherId = await verifyGoogleConnectState(state);
  if (!teacherId) {
    return calendarRedirect(req, "err=google_oauth");
  }

  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) {
    return calendarRedirect(req, "err=google_oauth");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const connectedEmail = emailFromGoogleIdToken(tokens.id_token);
    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token ?? teacher.googleRefreshToken,
        googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
        googleConnectedEmail: connectedEmail ?? teacher.googleConnectedEmail,
      },
    });
  } catch (e) {
    console.error("Google OAuth callback failed", e);
    return calendarRedirect(req, "err=google_oauth");
  }

  return calendarRedirect(req, "ok=google_connected");
}
