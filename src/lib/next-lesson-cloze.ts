import { revalidatePath } from "next/cache";
import { generateClozeFromLessonVocab } from "@/lib/ai";
import {
  boardShowsCloze,
  parseClassroomDoc,
  serializeClassroomDoc,
  writeRecallClozeToBoard,
} from "@/lib/classroom-doc";
import { prisma } from "@/lib/db";
import { parsePrepRefs, type VocabRecallItem } from "@/lib/prep-refs";
import { parseJsonArray, toJson } from "@/lib/utils";

type VocabRow = { term: string; reading?: string; meaning?: string };
type ExampleRow = { pattern: string; examples: string[] };

function parseVocab(raw: string | null | undefined): VocabRow[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as VocabRow[];
  } catch {
    return [];
  }
}

function parseExamples(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as ExampleRow[]).flatMap((row) =>
      Array.isArray(row.examples) ? row.examples.map(String) : [],
    );
  } catch {
    return [];
  }
}

function normalizeTerm(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function clozeCoversVocab(
  cloze: VocabRecallItem[],
  vocab: VocabRow[],
): boolean {
  const terms = vocab.map((v) => normalizeTerm(v.term ?? "")).filter(Boolean);
  if (terms.length === 0) return true;
  const answers = cloze.map((item) => normalizeTerm(item.answer));
  const hits = terms.filter((term) =>
    answers.some((answer) => answer.includes(term) || term.includes(answer)),
  );
  const needed = Math.min(
    terms.length,
    Math.max(2, Math.ceil(terms.length * 0.6)),
  );
  return hits.length >= needed;
}

function toPrepCloze(
  items: Array<{ blanked: string; hint: string; answer: string }>,
): VocabRecallItem[] {
  return items
    .map((item) => ({
      blanked: item.blanked.trim(),
      hint: item.hint.trim() || item.answer.trim(),
      answer: item.answer.trim(),
    }))
    .filter((item) => item.blanked && item.answer)
    .slice(0, 15);
}

export async function pushClozeToNextLesson(opts: {
  studentId: string;
  afterStartsAt: Date;
  exceptLessonId: string;
  cloze: VocabRecallItem[];
  /** Default true. Must be false during page render. */
  revalidate?: boolean;
}) {
  if (opts.cloze.length === 0) return null;

  const next = await prisma.lesson.findFirst({
    where: {
      studentId: opts.studentId,
      id: { not: opts.exceptLessonId },
      status: { in: ["scheduled", "in_progress"] },
      startsAt: { gt: opts.afterStartsAt },
    },
    orderBy: { startsAt: "asc" },
    include: { prepDraft: true },
  });
  if (!next) return null;

  const nextRefs = parsePrepRefs(next.prepDraft?.refsJson);
  nextRefs.vocabRecall = opts.cloze;
  await prisma.prepDraft.upsert({
    where: { lessonId: next.id },
    create: {
      lessonId: next.id,
      refsJson: toJson(nextRefs),
      status: "draft",
    },
    update: { refsJson: toJson(nextRefs) },
  });
  const existingDoc = parseClassroomDoc(next.classroomDoc);
  const bound =
    boardShowsCloze(existingDoc, opts.cloze) && existingDoc
      ? { doc: existingDoc, changed: false }
      : writeRecallClozeToBoard(existingDoc, opts.cloze);
  if (bound.changed) {
    await prisma.lesson.update({
      where: { id: next.id },
      data: { classroomDoc: serializeClassroomDoc(bound.doc) },
    });
  }
  if (opts.revalidate !== false) {
    revalidatePath(`/classroom/${next.id}`);
    revalidatePath(`/lessons/${next.id}`);
    revalidatePath("/prep");
  }
  return next.id;
}

/** After a lesson is summarized, write cloze for the following class from today's vocab. */
export async function materializeNextLessonClozeFromSummary(
  lessonId: string,
  opts?: { revalidate?: boolean },
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      summary: true,
      prepDraft: true,
      student: {
        select: { id: true, name: true, level: true, courseType: true },
      },
    },
  });
  if (!lesson?.summary)
    return { cloze: [] as VocabRecallItem[], nextLessonId: null };

  const vocab = parseVocab(lesson.summary.vocabJson);
  if (vocab.length === 0) {
    return { cloze: [] as VocabRecallItem[], nextLessonId: null };
  }

  const existingCloze = parsePrepRefs(
    lesson.prepDraft?.refsJson,
  ).nextVocabRecall;
  if (clozeCoversVocab(existingCloze, vocab) && existingCloze.length > 0) {
    const nextLessonId = await pushClozeToNextLesson({
      studentId: lesson.studentId,
      afterStartsAt: lesson.startsAt,
      exceptLessonId: lesson.id,
      cloze: existingCloze,
      revalidate: opts?.revalidate,
    });
    return { cloze: existingCloze, nextLessonId };
  }

  const generated = await generateClozeFromLessonVocab({
    studentName: lesson.student.name,
    level: lesson.student.level,
    courseType: lesson.student.courseType,
    vocab,
    topics: parseJsonArray(lesson.summary.topicsJson),
    examples: parseExamples(lesson.summary.examplesJson),
  });
  const cloze = toPrepCloze(generated);
  if (cloze.length === 0) {
    return { cloze: [], nextLessonId: null };
  }

  const refs = parsePrepRefs(lesson.prepDraft?.refsJson);
  refs.nextVocabRecall = cloze;
  refs.topics = parseJsonArray(lesson.summary.topicsJson).slice(0, 8);
  refs.vocab = vocab
    .map((v) => v.term)
    .filter(Boolean)
    .slice(0, 10);

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: {
      lessonId,
      refsJson: toJson(refs),
      status: lesson.prepDraft?.status ?? "draft",
    },
    update: { refsJson: toJson(refs) },
  });

  const nextLessonId = await pushClozeToNextLesson({
    studentId: lesson.studentId,
    afterStartsAt: lesson.startsAt,
    exceptLessonId: lesson.id,
    cloze,
    revalidate: opts?.revalidate,
  });

  return { cloze, nextLessonId };
}

/** Fill Friday-style next lessons that still have pre-class placeholder cloze. */
export async function ensureNextLessonClozeFromLatestSummary(
  studentId: string,
) {
  const last = await prisma.lesson.findFirst({
    where: {
      studentId,
      status: "completed",
      summary: { isNot: null },
    },
    orderBy: { startsAt: "desc" },
    include: { summary: true, prepDraft: true },
  });
  if (!last?.summary) return { updated: false, cloze: [] as VocabRecallItem[] };

  const vocab = parseVocab(last.summary.vocabJson);
  if (vocab.length === 0)
    return { updated: false, cloze: [] as VocabRecallItem[] };

  const existing = parsePrepRefs(last.prepDraft?.refsJson).nextVocabRecall;
  const next = await prisma.lesson.findFirst({
    where: {
      studentId,
      id: { not: last.id },
      status: { in: ["scheduled", "in_progress"] },
      startsAt: { gt: last.startsAt },
    },
    orderBy: { startsAt: "asc" },
    include: { prepDraft: true },
  });
  const nextCloze = parsePrepRefs(next?.prepDraft?.refsJson).vocabRecall;
  const nextDoc = parseClassroomDoc(next?.classroomDoc);

  if (clozeCoversVocab(nextCloze, vocab) && nextCloze.length > 0) {
    const nextLessonId = await pushClozeToNextLesson({
      studentId,
      afterStartsAt: last.startsAt,
      exceptLessonId: last.id,
      cloze: nextCloze,
      revalidate: false,
    });
    return {
      updated: Boolean(nextLessonId) && !boardShowsCloze(nextDoc, nextCloze),
      cloze: nextCloze,
    };
  }
  if (clozeCoversVocab(existing, vocab) && existing.length > 0) {
    const nextLessonId = await pushClozeToNextLesson({
      studentId,
      afterStartsAt: last.startsAt,
      exceptLessonId: last.id,
      cloze: existing,
      revalidate: false,
    });
    return { updated: Boolean(nextLessonId), cloze: existing };
  }

  const result = await materializeNextLessonClozeFromSummary(last.id, {
    revalidate: false,
  });
  return { updated: result.cloze.length > 0, cloze: result.cloze };
}
