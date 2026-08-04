import { summarizeTranscript, type LessonSummaryPayload } from "@/lib/ai";
import { prisma } from "@/lib/db";
import {
  nameHintsForStudent,
  pickBestDriveTranscript,
  type DriveFileLike,
} from "@/lib/drive-match";
import {
  exportDriveDocText,
  getValidAccessToken,
  listRecentDriveDocs,
} from "@/lib/google";
import {
  deriveStrengths,
  mergeStringLists,
  planGrammarMerge,
  planVocabMerge,
} from "@/lib/student-memory";
import { parseJsonArray, toJson } from "@/lib/utils";

export type DriveFetchStatus =
  | "imported"
  | "not_found"
  | "empty_doc"
  | "no_google_token"
  | "consent_denied"
  | "error";

export type DriveFetchResult = {
  status: DriveFetchStatus;
  fileName?: string;
  fileId?: string;
  message?: string;
};

type DriveFile = DriveFileLike;

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

  const picked = pickBestDriveTranscript(Array.from(seen.values()), {
    endsAt: opts.endsAt,
    studentName: opts.studentName,
  });
  return picked?.file ?? null;
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

  if (!lesson.student.recordingConsent) {
    return {
      status: "consent_denied",
      message: "Student has not consented to recording/transcript import. Paste manually or update consent.",
    };
  }

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

function scoreArchiveDoc(file: DriveFile, hints: string[]): number {
  const name = file.name.toLowerCase();
  let score = 0;
  for (const hint of hints) {
    const h = hint.toLowerCase();
    if (h.length >= 2 && name.includes(h)) score += 50;
  }
  if (/transcript|文字起こし|文字记录|gemini|meet|議事録|lesson|notes|ノート|授業|レッスン/.test(name)) {
    score += 25;
  }
  if (/doc|記録|memo|まとめ/.test(name)) score += 8;
  return score;
}

/** Push summary vocab/grammar/topics into the student memory bank. */
export async function persistSummaryToStudentMemory(lessonId: string) {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { summary: true },
  });
  if (!lesson.summary) return;

  const vocab = (() => {
    try {
      return JSON.parse(lesson.summary.vocabJson) as Array<{
        term: string;
        reading?: string;
        meaning?: string;
      }>;
    } catch {
      return [];
    }
  })();
  const grammar = (() => {
    try {
      return JSON.parse(lesson.summary.grammarJson) as Array<{
        pattern: string;
        notes?: string;
      }>;
    } catch {
      return [];
    }
  })();

  const existingVocab = await prisma.vocabItem.findMany({
    where: { studentId: lesson.studentId },
  });
  for (const op of planVocabMerge(vocab, existingVocab)) {
    if (op.action === "create") {
      await prisma.vocabItem.create({
        data: {
          studentId: lesson.studentId,
          term: op.term,
          reading: op.reading,
          meaning: op.meaning,
        },
      });
    } else {
      await prisma.vocabItem.update({
        where: { id: op.id },
        data: { reading: op.reading, meaning: op.meaning },
      });
    }
  }

  const existingGrammar = await prisma.grammarItem.findMany({
    where: { studentId: lesson.studentId },
  });
  for (const op of planGrammarMerge(grammar, existingGrammar)) {
    if (op.action === "create") {
      await prisma.grammarItem.create({
        data: {
          studentId: lesson.studentId,
          pattern: op.pattern,
          notes: op.notes,
        },
      });
    } else {
      await prisma.grammarItem.update({
        where: { id: op.id },
        data: { notes: op.notes },
      });
    }
  }

  const topics = parseJsonArray(lesson.summary.topicsJson);
  const mistakes = parseJsonArray(lesson.summary.mistakesJson);
  const newStrengths = deriveStrengths(topics, mistakes);

  const existing = await prisma.progressSnapshot.findUnique({
    where: { studentId: lesson.studentId },
  });
  const covered = mergeStringLists(
    existing ? parseJsonArray(existing.topicsCoveredJson) : [],
    topics,
    40,
  );
  const strengths = mergeStringLists(
    existing ? parseJsonArray(existing.strengthsJson) : [],
    newStrengths,
    12,
  );
  const weaknesses = mergeStringLists(
    existing ? parseJsonArray(existing.weaknessesJson) : [],
    mistakes,
    12,
  );

  await prisma.progressSnapshot.upsert({
    where: { studentId: lesson.studentId },
    create: {
      studentId: lesson.studentId,
      topicsCoveredJson: toJson(covered),
      strengthsJson: toJson(strengths),
      weaknessesJson: toJson(weaknesses),
      attendanceCount: 1,
      note: lesson.summary.nextFocus,
    },
    update: {
      topicsCoveredJson: toJson(covered),
      strengthsJson: toJson(strengths),
      weaknessesJson: toJson(weaknesses),
      attendanceCount: (existing?.attendanceCount ?? 0) + 1,
      note: lesson.summary.nextFocus,
    },
  });

  await prisma.summary.update({
    where: { lessonId },
    data: { approved: true },
  });
}

export type DriveSeedResult = {
  studentsProcessed: number;
  lessonsCreated: number;
  docsScanned: number;
  skippedStudents: number;
  errors: string[];
};

/**
 * Scan Drive for notes/transcripts matching each student and create past completed lessons
 * with AI summaries + memory bank entries. Skips students who already have approved history
 * unless force=true.
 */
export async function seedMemoryFromDriveForTeacher(
  teacherId: string,
  opts: { force?: boolean; maxDocsPerStudent?: number } = {},
): Promise<DriveSeedResult> {
  const maxDocs = opts.maxDocsPerStudent ?? 4;
  const result: DriveSeedResult = {
    studentsProcessed: 0,
    lessonsCreated: 0,
    docsScanned: 0,
    skippedStudents: 0,
    errors: [],
  };

  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) {
    result.errors.push("Teacher not found");
    return result;
  }

  const accessToken = await getValidAccessToken(teacher);
  if (!accessToken) {
    result.errors.push("Connect Google in Settings first (Drive readonly).");
    return result;
  }
  await persistRefreshedToken(teacherId, teacher, accessToken);

  const students = await prisma.student.findMany({
    where: { teacherId, archivedAt: null },
    include: {
      lessons: {
        where: { status: "completed", summary: { is: { approved: true } } },
        take: 1,
      },
      vocabItems: { take: 1 },
      grammarItems: { take: 1 },
    },
    orderBy: { name: "asc" },
  });

  const usedDriveIds = new Set(
    (
      await prisma.lesson.findMany({
        where: { teacherId, driveFileId: { not: null } },
        select: { driveFileId: true },
      })
    )
      .map((l) => l.driveFileId)
      .filter(Boolean) as string[],
  );

  for (const student of students) {
    const hasMemory =
      student.lessons.length > 0 || student.vocabItems.length > 0 || student.grammarItems.length > 0;
    if (hasMemory && !opts.force) {
      result.skippedStudents += 1;
      continue;
    }

    result.studentsProcessed += 1;
    const hints = nameHintsForStudent(student.name);
    const primary = hints[0] ?? student.name;

    const seen = new Map<string, DriveFile>();
    for (const q of [primary, ...hints.slice(1, 3), "文字起こし", "transcript"]) {
      const batch = await listRecentDriveDocs({
        accessToken,
        folderId: teacher.googleTranscriptFolderId,
        query: q,
        nameContains: q && !["文字起こし", "transcript"].includes(q) ? q : undefined,
        pageSize: 25,
      });
      for (const f of batch) seen.set(f.id, f);
    }

    const ranked = Array.from(seen.values())
      .map((f) => ({ f, score: scoreArchiveDoc(f, hints) }))
      .filter((x) => x.score >= 40 && !usedDriveIds.has(x.f.id))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const am = a.f.modifiedTime ? +new Date(a.f.modifiedTime) : 0;
        const bm = b.f.modifiedTime ? +new Date(b.f.modifiedTime) : 0;
        return bm - am;
      })
      .slice(0, maxDocs);

    result.docsScanned += seen.size;

    for (const { f } of ranked) {
      try {
        const rawText = await exportDriveDocText(accessToken, f.id);
        if (!rawText.trim() || rawText.trim().length < 80) continue;

        const end = f.modifiedTime
          ? new Date(f.modifiedTime)
          : f.createdTime
            ? new Date(f.createdTime)
            : new Date();
        const start = new Date(end.getTime() - 60 * 60 * 1000);

        const lesson = await prisma.lesson.create({
          data: {
            teacherId,
            studentId: student.id,
            startsAt: start,
            endsAt: end,
            status: "completed",
            prepStatus: "none",
            transcriptStatus: "imported",
            driveFileId: f.id,
            tagsJson: toJson(["drive_archive"]),
          },
        });
        usedDriveIds.add(f.id);

        await applyTranscriptToLesson({
          lessonId: lesson.id,
          rawText,
          source: "drive_import",
          driveFileId: f.id,
          tags: ["drive_archive"],
        });
        await persistSummaryToStudentMemory(lesson.id);
        result.lessonsCreated += 1;
      } catch (e) {
        result.errors.push(
          `${student.name} / ${f.name}: ${e instanceof Error ? e.message : "failed"}`,
        );
      }
    }
  }

  return result;
}
