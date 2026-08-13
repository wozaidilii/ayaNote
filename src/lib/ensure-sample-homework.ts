import { prisma } from "@/lib/db";
import { serializeQuiz } from "@/lib/homework-quiz";
import {
  buildSampleQuizForLevel,
  sampleQuizInstructions,
  sampleQuizTitle,
} from "@/lib/sample-level-quiz";

export const SAMPLE_LEVEL_SOURCE = "sample_level";

/**
 * Ensure the student has one assigned sample-level quiz (10 Qs).
 * Skips if they already completed/reviewed a sample quiz.
 * Refreshes questions if still assigned.
 */
export async function ensureSampleLevelHomework(opts: {
  studentId: string;
  level: string;
  courseType?: string;
}) {
  const { jlpt, questions } = buildSampleQuizForLevel(
    opts.level,
    opts.courseType,
  );
  if (questions.length === 0) {
    throw new Error(`No sample quiz for level ${jlpt}`);
  }

  const existing = await prisma.homework.findFirst({
    where: { studentId: opts.studentId, source: SAMPLE_LEVEL_SOURCE },
    orderBy: { createdAt: "desc" },
  });

  if (
    existing &&
    (existing.status === "done" || existing.status === "reviewed")
  ) {
    return { homework: existing, created: false, refreshed: false, jlpt };
  }

  const data = {
    title: sampleQuizTitle(jlpt),
    instructions: sampleQuizInstructions(jlpt),
    kind: "quiz" as const,
    quizJson: serializeQuiz(questions),
    answersJson: "[]",
    score: null as number | null,
    status: "assigned" as const,
    source: SAMPLE_LEVEL_SOURCE,
    lessonId: null as string | null,
    completedAt: null as Date | null,
  };

  if (existing) {
    const homework = await prisma.homework.update({
      where: { id: existing.id },
      data,
    });
    return { homework, created: false, refreshed: true, jlpt };
  }

  const homework = await prisma.homework.create({
    data: {
      studentId: opts.studentId,
      ...data,
    },
  });
  return { homework, created: true, refreshed: false, jlpt };
}

export async function ensureSampleLevelHomeworkForAllStudents() {
  const students = await prisma.student.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, level: true, courseType: true },
    orderBy: { name: "asc" },
  });

  const results: Array<{
    studentId: string;
    name: string;
    jlpt: string;
    created: boolean;
    refreshed: boolean;
  }> = [];

  for (const s of students) {
    const r = await ensureSampleLevelHomework({
      studentId: s.id,
      level: s.level,
      courseType: s.courseType,
    });
    results.push({
      studentId: s.id,
      name: s.name,
      jlpt: r.jlpt,
      created: r.created,
      refreshed: r.refreshed,
    });
  }

  return results;
}
