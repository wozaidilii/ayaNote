import { NextResponse } from "next/server";
import { getActiveStudentOrNull } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;
  const session = await getSession();

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      teacherId: true,
      studentId: true,
      transcriptStatus: true,
      summary: { select: { id: true } },
      transcript: { select: { id: true } },
    },
  });
  if (!lesson) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (session.role === "teacher" && session.teacherId) {
    if (lesson.teacherId !== session.teacherId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (session.role === "student") {
    const student = await getActiveStudentOrNull();
    if (!student || student.teacherId !== lesson.teacherId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ready: Boolean(lesson.summary),
    hasSummary: Boolean(lesson.summary),
    hasTranscript: Boolean(lesson.transcript),
    transcriptStatus: lesson.transcriptStatus,
  });
}
