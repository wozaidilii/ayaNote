import { applyTranscriptToLesson } from "@/lib/drive-transcript";
import { prisma } from "@/lib/db";
import { sttConfigured, transcribeAudioFile } from "@/lib/stt";

export type ProcessingStatus =
  "idle" | "uploading" | "transcribing" | "summarizing" | "ready" | "failed";

const PART_MAX_BYTES = 12 * 1024 * 1024; // ~12MB per segment

export async function setLessonProcessing(
  lessonId: string,
  status: ProcessingStatus,
  error = "",
) {
  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      processingStatus: status,
      processingError: error,
    },
  });
}

/** Append STT text to the lesson transcript without summarizing yet. */
export async function appendTranscriptPart(opts: {
  lessonId: string;
  text: string;
  source?: string;
}) {
  const existing = await prisma.transcript.findUnique({
    where: { lessonId: opts.lessonId },
  });
  const joined = existing?.rawText?.trim()
    ? `${existing.rawText.trim()}\n\n${opts.text.trim()}`
    : opts.text.trim();

  await prisma.transcript.upsert({
    where: { lessonId: opts.lessonId },
    create: {
      lessonId: opts.lessonId,
      source: opts.source ?? "livekit",
      rawText: joined,
      editedText: joined,
    },
    update: {
      source: opts.source ?? "livekit",
      rawText: joined,
      editedText: joined,
    },
  });

  return joined;
}

/**
 * Accept one classroom audio segment: STT immediately and append text.
 * Audio is not retained after transcription.
 */
export async function ingestAudioPart(opts: {
  lessonId: string;
  file: Blob;
  filename: string;
}) {
  if (!sttConfigured()) {
    return { ok: false as const, error: "stt_not_configured", status: 503 };
  }
  if (opts.file.size < 256) {
    return { ok: false as const, error: "audio_too_small", status: 400 };
  }
  if (opts.file.size > PART_MAX_BYTES) {
    return { ok: false as const, error: "audio_too_large", status: 413 };
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: opts.lessonId },
    select: {
      id: true,
      nextAudioPartIndex: true,
      processingStatus: true,
    },
  });
  if (!lesson) {
    return { ok: false as const, error: "not_found", status: 404 };
  }

  // Fresh recording after a finished/failed run — clear prior segments + text
  if (
    lesson.processingStatus === "ready" ||
    lesson.processingStatus === "failed" ||
    lesson.processingStatus === "idle"
  ) {
    if (lesson.nextAudioPartIndex > 0 || lesson.processingStatus !== "idle") {
      await prisma.$transaction([
        prisma.lessonAudioPart.deleteMany({
          where: { lessonId: opts.lessonId },
        }),
        prisma.transcript.deleteMany({ where: { lessonId: opts.lessonId } }),
        prisma.lesson.update({
          where: { id: opts.lessonId },
          data: {
            nextAudioPartIndex: 0,
            processingStatus: "transcribing",
            processingError: "",
          },
        }),
      ]);
      lesson.nextAudioPartIndex = 0;
    }
  }

  const partIndex = lesson.nextAudioPartIndex;
  await setLessonProcessing(opts.lessonId, "transcribing");

  const stt = await transcribeAudioFile(opts.file, opts.filename);
  if (!stt.ok) {
    await prisma.lessonAudioPart.create({
      data: {
        lessonId: opts.lessonId,
        partIndex,
        byteSize: opts.file.size,
        status: "failed",
        error: stt.error.slice(0, 500),
      },
    });
    await setLessonProcessing(opts.lessonId, "failed", stt.error.slice(0, 500));
    return {
      ok: false as const,
      error: "stt_failed",
      detail: stt.error,
      status: 502,
    };
  }

  const fullText = await appendTranscriptPart({
    lessonId: opts.lessonId,
    text: stt.text,
    source: "livekit",
  });

  await prisma.$transaction([
    prisma.lessonAudioPart.create({
      data: {
        lessonId: opts.lessonId,
        partIndex,
        byteSize: opts.file.size,
        charCount: stt.text.length,
        status: "done",
      },
    }),
    prisma.lesson.update({
      where: { id: opts.lessonId },
      data: {
        nextAudioPartIndex: partIndex + 1,
        processingStatus: "uploading",
        processingError: "",
        transcriptStatus: "imported",
      },
    }),
  ]);

  return {
    ok: true as const,
    partIndex,
    chars: stt.text.length,
    totalChars: fullText.length,
    sttProvider: stt.provider,
  };
}

/** Run map-reduce summary on accumulated transcript (or provided text). */
export async function finalizeLessonSummary(opts: {
  lessonId: string;
  /** If provided, replaces transcript before summarizing (legacy single-shot). */
  rawText?: string;
  source?: "livekit" | "upload" | "manual" | "drive_import" | "meet_import";
}) {
  await setLessonProcessing(opts.lessonId, "summarizing");

  try {
    let rawText = opts.rawText?.trim() ?? "";
    if (!rawText) {
      const tr = await prisma.transcript.findUnique({
        where: { lessonId: opts.lessonId },
      });
      rawText = (tr?.editedText || tr?.rawText || "").trim();
    }
    if (!rawText) {
      await setLessonProcessing(
        opts.lessonId,
        "failed",
        "No transcript text to summarize",
      );
      return { ok: false as const, error: "empty_transcript" };
    }

    await applyTranscriptToLesson({
      lessonId: opts.lessonId,
      rawText,
      source: opts.source ?? "livekit",
    });

    await setLessonProcessing(opts.lessonId, "ready");
    return { ok: true as const, chars: rawText.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "summarize_failed";
    await setLessonProcessing(opts.lessonId, "failed", message.slice(0, 500));
    return { ok: false as const, error: message };
  }
}
