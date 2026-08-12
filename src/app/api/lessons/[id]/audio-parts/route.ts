import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestAudioPart } from "@/lib/lesson-processing";
import { sttConfigured } from "@/lib/stt";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;

async function canTeacherAccessLesson(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, teacherId: true },
  });
  if (!lesson) return { ok: false as const, status: 404, error: "not_found" };

  const session = await getSession();
  if (session.role === "teacher" && session.teacherId) {
    if (lesson.teacherId !== session.teacherId) {
      return { ok: false as const, status: 403, error: "forbidden" };
    }
    return { ok: true as const, lesson };
  }
  return { ok: false as const, status: 401, error: "unauthorized" };
}

/** Upload one classroom audio segment; STT immediately and append transcript text. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;
  const access = await canTeacherAccessLesson(lessonId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  if (!sttConfigured()) {
    return NextResponse.json({ error: "stt_not_configured" }, { status: 503 });
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  const file = audio as File;
  const filename = file.name || `part-${Date.now()}.webm`;
  const result = await ingestAudioPart({
    lessonId,
    file,
    filename,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        detail: "detail" in result ? result.detail : undefined,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    partIndex: result.partIndex,
    chars: result.chars,
    totalChars: result.totalChars,
    sttProvider: result.sttProvider,
  });
}
