import { NextRequest, NextResponse } from "next/server";
import { applyTranscriptToLesson } from "@/lib/drive-transcript";
import { prisma } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";
import { sttConfigured, transcribeAudioFile } from "@/lib/stt";
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

  if (!sttConfigured()) {
    return NextResponse.json({ error: "stt_not_configured" }, { status: 503 });
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  const file = audio as File;
  if (file.size < 256) {
    return NextResponse.json({ error: "audio_too_small" }, { status: 400 });
  }
  // ~25MB soft cap for L1
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }

  const filename = file.name || "classroom.webm";
  const stt = await transcribeAudioFile(file, filename);
  if (!stt.ok) {
    return NextResponse.json(
      { error: "stt_failed", detail: stt.error },
      { status: 502 },
    );
  }

  await applyTranscriptToLesson({
    lessonId,
    rawText: stt.text,
    source: "livekit",
  });

  const provider = getAiProvider();
  const hasAiKey =
    provider === "deepseek"
      ? Boolean(process.env.DEEPSEEK_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY);

  return NextResponse.json({
    ok: true,
    chars: stt.text.length,
    sttProvider: stt.provider,
    summarized: true,
    aiReady: hasAiKey,
  });
}
