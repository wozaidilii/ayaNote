import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteLivekitRoom, livekitConfigured } from "@/lib/livekit";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/** Teacher ends the call for everyone — deletes the LiveKit room. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;
  const session = await getSession();
  if (
    !session.authenticated ||
    session.role !== "teacher" ||
    !session.teacherId
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { teacherId: true },
  });
  if (!lesson) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (lesson.teacherId !== session.teacherId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (livekitConfigured()) {
    await deleteLivekitRoom(lessonId);
  }

  return NextResponse.json({ ok: true });
}
