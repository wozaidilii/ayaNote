import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";
import {
  finalizeLessonSummary,
  ingestAudioPart,
  setLessonProcessing,
} from "@/lib/lesson-processing";
import { sttConfigured } from "@/lib/stt";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;

async function canAccessLesson(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, teacherId: true, studentId: true },
  });
  if (!lesson) return { ok: false as const, status: 404, error: "not_found" };

  const session = await getSession();
  // Transcription / summary is teacher-only (not student, not guest).
  if (session.role === "teacher" && session.teacherId) {
    if (lesson.teacherId !== session.teacherId) {
      return { ok: false as const, status: 403, error: "forbidden" };
    }
    return { ok: true as const, lesson };
  }

  return { ok: false as const, status: 401, error: "unauthorized" };
}

/**
 * Finalize classroom transcription + summary.
 * - With `audio` form field: legacy / final segment — STT then summarize (or append if parts exist).
 * - With `finalize=1` only: summarize accumulated transcript from prior audio-parts.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;
  const access = await canAccessLesson(lessonId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const form = await req.formData();
  const finalizeOnly =
    form.get("finalize") === "1" || form.get("finalize") === "true";
  const audio = form.get("audio");

  if (!finalizeOnly && (!audio || typeof audio === "string")) {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  if (audio && typeof audio !== "string") {
    if (!sttConfigured()) {
      return NextResponse.json(
        { error: "stt_not_configured" },
        { status: 503 },
      );
    }
    const file = audio as File;
    if (file.size >= 256) {
      const part = await ingestAudioPart({
        lessonId,
        file,
        filename: file.name || "classroom.webm",
      });
      if (!part.ok) {
        return NextResponse.json(
          {
            error: part.error,
            detail: "detail" in part ? part.detail : undefined,
          },
          { status: part.status },
        );
      }
    }
  }

  // If client already uploaded parts and only wants summarize — or after final segment
  await setLessonProcessing(lessonId, "summarizing");
  const result = await finalizeLessonSummary({
    lessonId,
    source: "livekit",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "summarize_failed" },
      { status: 502 },
    );
  }

  const provider = getAiProvider();
  const hasAiKey =
    provider === "deepseek"
      ? Boolean(process.env.DEEPSEEK_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY);

  return NextResponse.json({
    ok: true,
    chars: result.chars,
    summarized: true,
    aiReady: hasAiKey,
  });
}
