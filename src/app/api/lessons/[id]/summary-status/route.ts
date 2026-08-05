import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
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
    select: {
      teacherId: true,
      transcriptStatus: true,
      summary: { select: { id: true } },
      transcript: { select: { id: true } },
    },
  });
  if (!lesson) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (lesson.teacherId !== session.teacherId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ready: Boolean(lesson.summary),
    hasSummary: Boolean(lesson.summary),
    hasTranscript: Boolean(lesson.transcript),
    transcriptStatus: lesson.transcriptStatus,
  });
}
