import { summarizeTranscript, type LessonSummaryPayload } from "@/lib/ai";
import { prisma } from "@/lib/db";
import {
  exportDriveDocText,
  getValidAccessToken,
  listRecentDriveDocs,
} from "@/lib/google";
import { toJson } from "@/lib/utils";

export type DriveFetchStatus =
  | "imported"
  | "not_found"
  | "empty_doc"
  | "no_google_token"
  | "error";

export type DriveFetchResult = {
  status: DriveFetchStatus;
  fileName?: string;
  fileId?: string;
  message?: string;
};

type DriveFile = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
};

function nameHintsForStudent(studentName: string) {
  const raw = studentName.trim();
  const parts = raw
    .replace(/[\[\]]/g, " ")
    .split(/[\s_・]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !/^(さん|様|lesson|japanese|日本語)$/i.test(p));
  return Array.from(new Set([raw, ...parts])).filter(Boolean);
}

function scoreDriveFile(
  file: DriveFile,
  opts: { endMs: number; hints: string[]; windowMs: number },
): number {
  const name = file.name.toLowerCase();
  let score = 0;
  const mod = file.modifiedTime
    ? new Date(file.modifiedTime).getTime()
    : file.createdTime
      ? new Date(file.createdTime).getTime()
      : 0;
  if (mod) {
    const delta = Math.abs(mod - opts.endMs);
    if (delta <= opts.windowMs) score += 100 - Math.min(90, delta / (60_000 * 2));
    else if (delta <= opts.windowMs * 2) score += 20;
  }
  for (const hint of opts.hints) {
    const h = hint.toLowerCase();
    if (h.length >= 2 && name.includes(h)) score += 40;
  }
  if (/transcript|文字起こし|文字记录|gemini|meet recording|議事録/.test(name)) score += 35;
  if (/doc|notes/.test(name)) score += 5;
  return score;
}

/** List + rank Drive Docs that look like a Meet transcript for this lesson. */
export async function findTranscriptDriveDoc(opts: {
  accessToken: string;
  folderId?: string | null;
  studentName: string;
  endsAt: Date;
  meetLink?: string | null;
}): Promise<DriveFile | null> {
  const hints = nameHintsForStudent(opts.studentName);
  const primaryHint = hints[0] ?? opts.studentName;
  const windowMs = 4 * 60 * 60 * 1000;

  const searches: Array<string | undefined> = [
    primaryHint,
    ...hints.slice(1, 3),
    "transcript",
    "文字起こし",
    undefined,
  ];

  const seen = new Map<string, DriveFile>();
  for (const q of searches) {
    const batch = await listRecentDriveDocs({
      accessToken: opts.accessToken,
      folderId: opts.folderId,
      query: q,
      nameContains: q && !["transcript", "文字起こし"].includes(q) ? q : undefined,
      pageSize: 30,
    });
    for (const f of batch) seen.set(f.id, f);
    if (seen.size >= 40) break;
  }

  const files = Array.from(seen.values());
  if (files.length === 0) return null;

  const endMs = opts.endsAt.getTime();
  const ranked = files
    .map((f) => ({ f, score: scoreDriveFile(f, { endMs, hints, windowMs }) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 25) return null;
  return best.f;
}

async function persistRefreshedToken(
  teacherId: string,
  teacher: {
    googleAccessToken: string | null;
    googleTokenExpiry: Date | null;
  },
  accessToken: string,
) {
  if (
    accessToken !== teacher.googleAccessToken ||
    !teacher.googleTokenExpiry ||
    teacher.googleTokenExpiry.getTime() <= Date.now() + 60_000
  ) {
    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        googleAccessToken: accessToken,
        googleTokenExpiry: new Date(Date.now() + 3500_000),
      },
    });
  }
}

function summaryPersistData(summary: LessonSummaryPayload) {
  return {
    topicsJson: toJson(summary.topics),
    vocabJson: toJson(summary.vocab),
    grammarJson: toJson(summary.grammar),
    mistakesJson: toJson(summary.mistakes),
    examplesJson: toJson(summary.examples),
    todaySummary: summary.todaySummary,
    priorReview: summary.priorReview,
    homework: summary.homework,
    nextFocus: summary.nextFocus,
    notes: summary.notes,
    approved: false,
  };
}

async function buildSummarizeContext(lessonId: string) {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: {
      student: {
        include: {
          vocabItems: { orderBy: { createdAt: "desc" }, take: 20 },
          grammarItems: { orderBy: { createdAt: "desc" }, take: 12 },
          lessons: {
            where: {
              status: "completed",
              id: { not: lessonId },
            },
            include: { summary: true },
            orderBy: { startsAt: "desc" },
            take: 2,
          },
        },
      },
    },
  });

  const priorSummaries = lesson.student.lessons
    .map((l) => l.summary)
    .filter(Boolean);

  const priorTopics = priorSummaries.flatMap((s) => {
    try {
      return JSON.parse(s!.topicsJson) as string[];
    } catch {
      return [];
    }
  });

  const priorVocabFromSummary = priorSummaries.flatMap((s) => {
    try {
      return JSON.parse(s!.vocabJson) as Array<{
        term: string;
        reading?: string;
        meaning?: string;
      }>;
    } catch {
      return [];
    }
  });

  const priorGrammarFromSummary = priorSummaries.flatMap((s) => {
    try {
      return JSON.parse(s!.grammarJson) as Array<{
        pattern: string;
        notes?: string;
      }>;
    } catch {
      return [];
    }
  });

  return {
    studentName: lesson.student.name,
    level: lesson.student.level,
    courseType: lesson.student.courseType,
    goals: lesson.student.goals,
    priorTopics,
    priorVocab:
      priorVocabFromSummary.length > 0
        ? priorVocabFromSummary
        : lesson.student.vocabItems.map((v) => ({
            term: v.term,
            reading: v.reading,
            meaning: v.meaning,
          })),
    priorGrammar:
      priorGrammarFromSummary.length > 0
        ? priorGrammarFromSummary
        : lesson.student.grammarItems.map((g) => ({
            pattern: g.pattern,
            notes: g.notes,
          })),
    priorNextFocus: priorSummaries[0]?.nextFocus,
  };
}

/** Import a Drive Doc into a lesson and generate summary. */
export async function applyTranscriptToLesson(opts: {
  lessonId: string;
  rawText: string;
  source: "drive_import" | "meet_import";
  driveFileId?: string | null;
  tags?: string[];
}) {
  const context = await buildSummarizeContext(opts.lessonId);
  const summary = await summarizeTranscript(opts.rawText, context);
  const data = summaryPersistData(summary);

  await prisma.lesson.update({
    where: { id: opts.lessonId },
    data: {
      status: "completed",
      transcriptStatus: opts.source === "drive_import" ? "imported" : "manual",
      ...(opts.driveFileId ? { driveFileId: opts.driveFileId } : {}),
      ...(opts.tags ? { tagsJson: toJson(opts.tags) } : {}),
      transcript: {
        upsert: {
          create: {
            source: opts.source,
            rawText: opts.rawText,
            editedText: opts.rawText,
          },
          update: {
            source: opts.source,
            rawText: opts.rawText,
            editedText: opts.rawText,
          },
        },
      },
      summary: {
        upsert: {
          create: data,
          update: data,
        },
      },
    },
  });
  return summary;
}

/** Find Drive transcript for one lesson, import, summarize. */
export async function fetchAndImportDriveTranscript(lessonId: string): Promise<DriveFetchResult> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { student: true, teacher: true },
  });
  if (!lesson) return { status: "error", message: "Lesson not found" };

  try {
    const accessToken = await getValidAccessToken(lesson.teacher);
    if (!accessToken) {
      return {
        status: "no_google_token",
        message: "Connect Google in Settings (Drive readonly required).",
      };
    }
    await persistRefreshedToken(lesson.teacherId, lesson.teacher, accessToken);

    const hit = await findTranscriptDriveDoc({
      accessToken,
      folderId: lesson.teacher.googleTranscriptFolderId,
      studentName: lesson.student.name,
      endsAt: lesson.endsAt,
      meetLink: lesson.meetLink,
    });

    if (!hit) {
      return {
        status: "not_found",
        message:
          "No matching Google Doc found near lesson end time. Check Meet transcript landed in Drive, or paste manually.",
      };
    }

    const rawText = await exportDriveDocText(accessToken, hit.id);
    if (!rawText.trim()) {
      return { status: "empty_doc", fileName: hit.name, fileId: hit.id };
    }

    await applyTranscriptToLesson({
      lessonId,
      rawText,
      source: "drive_import",
      driveFileId: hit.id,
    });

    return { status: "imported", fileName: hit.name, fileId: hit.id };
  } catch (e) {
    console.error("fetchAndImportDriveTranscript failed", lessonId, e);
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
