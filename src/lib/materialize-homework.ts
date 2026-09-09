import { prisma } from "@/lib/db";
import {
  buildQuizFromVocab,
  serializeQuiz,
  type VocabForQuiz,
} from "@/lib/homework-quiz";

function parseVocabJson(raw: string | null | undefined): VocabForQuiz[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as VocabForQuiz[];
  } catch {
    return [];
  }
}

/**
 * Turn lesson-summary vocab into a student homework row as soon as
 * the summary exists — do not wait for teacher approval.
 */
export async function materializeLessonHomework(opts: {
  lessonId: string;
  studentId: string;
  vocabJson: string;
  homeworkText?: string;
}) {
  const vocab = parseVocabJson(opts.vocabJson);
  const quiz = buildQuizFromVocab(vocab);
  const instructions =
    (opts.homeworkText ?? "").trim() ||
    (quiz.length > 0
      ? `Vocabulary quiz · ${quiz.length} questions from today's lesson`
      : "");

  if (!instructions && quiz.length === 0) return null;

  const existingHw = await prisma.homework.findUnique({
    where: { lessonId: opts.lessonId },
    select: { status: true },
  });
  const keepStatus =
    existingHw?.status === "done" || existingHw?.status === "reviewed"
      ? existingHw.status
      : "assigned";
  const kind = quiz.length > 0 ? "quiz" : "text";

  return prisma.homework.upsert({
    where: { lessonId: opts.lessonId },
    create: {
      lessonId: opts.lessonId,
      studentId: opts.studentId,
      title: quiz.length > 0 ? "Vocabulary quiz" : "Homework",
      instructions,
      kind,
      quizJson: serializeQuiz(quiz),
      answersJson: "[]",
      score: null,
      status: "assigned",
      source: "ai_summary",
    },
    update: {
      title: quiz.length > 0 ? "Vocabulary quiz" : "Homework",
      instructions,
      kind,
      quizJson: serializeQuiz(quiz),
      source: "ai_summary",
      status: keepStatus,
      ...(keepStatus === "assigned"
        ? { answersJson: "[]", score: null, completedAt: null }
        : {}),
    },
  });
}

/** Backfill quizzes for summaries that were generated before homework existed. */
export async function ensureLessonHomeworkFromSummaries(studentId: string) {
  const lessons = await prisma.lesson.findMany({
    where: {
      studentId,
      summary: { isNot: null },
      homeworks: { none: {} },
    },
    include: { summary: { select: { vocabJson: true, homework: true } } },
    orderBy: { startsAt: "desc" },
    take: 8,
  });

  for (const lesson of lessons) {
    if (!lesson.summary) continue;
    await materializeLessonHomework({
      lessonId: lesson.id,
      studentId,
      vocabJson: lesson.summary.vocabJson,
      homeworkText: lesson.summary.homework,
    });
  }
}
