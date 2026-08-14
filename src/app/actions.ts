"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addMinutes } from "date-fns";
import {
  COURSE_TYPES,
  courseTypeLabel,
  generatePrepDraft,
  getAiProvider,
} from "@/lib/ai";
import {
  isCalendarInboxEmail,
  isCalendarPlaceholderEmail,
  listGoogleBusyIntervals,
  syncTeacherCalendar,
} from "@/lib/calendar-sync";
import {
  notifyBookingDecision,
  notifyBookingSubmitted,
} from "@/lib/booking-email";
import {
  buildQuizFromVocab,
  parseAnswersJson,
  parseQuizJson,
  scoreQuiz,
  serializeAnswers,
  serializeQuiz,
} from "@/lib/homework-quiz";
import { ensureSampleLevelHomework } from "@/lib/ensure-sample-homework";
import { applyTranscriptToLesson } from "@/lib/drive-transcript";
import {
  clearAuthSession,
  hashPassword,
  setAuthSession,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createGuestId, setGuestSession } from "@/lib/guest-session";
import { createInviteToken, inviteExpiry } from "@/lib/invite";
import {
  parsePrepRefs,
  type PrepRefs,
  type VocabRecallItem,
} from "@/lib/prep-refs";
import {
  LESSON_MINUTES,
  blackoutDateFromYmd,
  intervalsOverlap,
} from "@/lib/scheduling";
import { requireStudent, requireTeacher } from "@/lib/session";
import { formatInTz, normalizeTimezone, parseIsoOrLocal } from "@/lib/timezone";
import {
  bindClassroomDocToPrep,
  parseClassroomDoc,
  serializeClassroomDoc,
  tiptapDocToPlainText,
} from "@/lib/classroom-doc";
import { parseJsonArray, toJson } from "@/lib/utils";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    redirect("/?err=missing");
  }

  const teacher = await prisma.teacher.findUnique({ where: { email } });
  if (teacher?.passwordHash) {
    const ok = await verifyPassword(password, teacher.passwordHash);
    if (ok) {
      await setAuthSession({ role: "teacher", teacherId: teacher.id });
      redirect("/today");
    }
  }

  const student = await prisma.student.findFirst({
    where: { email, archivedAt: null },
  });
  if (
    student?.passwordHash &&
    !isCalendarInboxEmail(student.email) &&
    !isCalendarPlaceholderEmail(student.email)
  ) {
    const ok = await verifyPassword(password, student.passwordHash);
    if (ok) {
      await setAuthSession({
        role: "student",
        studentId: student.id,
        teacherId: student.teacherId,
      });
      redirect("/student");
    }
  }

  redirect("/?err=invalid");
}

/** @deprecated Prefer `login` — kept for any leftover imports. */
export async function loginTeacher(formData: FormData) {
  return login(formData);
}

export async function logout() {
  await clearAuthSession();
  redirect("/");
}

/** Guest join for a shareable classroom link (no account). */
export async function joinClassroomAsGuest(formData: FormData) {
  const lessonId = String(formData.get("lessonId") ?? "").trim();
  const rawName = String(formData.get("name") ?? "").trim();
  const name = (rawName || "Guest").slice(0, 48);
  if (!lessonId) redirect("/");

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, status: true },
  });
  if (!lesson || lesson.status === "cancelled") {
    redirect("/");
  }

  await setGuestSession({
    lessonId: lesson.id,
    guestId: createGuestId(),
    name,
  });
  redirect(`/classroom/${lesson.id}`);
}

/** Bind student session from invite token (reusable until regenerated/expired). */
export async function acceptInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/?err=invite_invalid");
  const student = await prisma.student.findUnique({
    where: { inviteToken: token },
  });
  if (!student || student.archivedAt) {
    redirect("/?err=invite_invalid");
  }
  if (
    student.inviteTokenExpiresAt &&
    student.inviteTokenExpiresAt < new Date()
  ) {
    redirect("/?err=invite_expired");
  }
  await setAuthSession({
    role: "student",
    studentId: student.id,
    teacherId: student.teacherId,
  });
  redirect("/student");
}

export async function setLocale(locale: "ja" | "en") {
  const jar = await cookies();
  jar.set("ayanote_locale", locale, { path: "/" });
  revalidatePath("/", "layout");
}

async function getTeacher() {
  return requireTeacher();
}

export async function importTranscriptAndSummarize(formData: FormData) {
  const teacher = await getTeacher();
  const lessonId = String(formData.get("lessonId") ?? "");
  const rawText = String(formData.get("transcript") ?? "");
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!lessonId) {
    redirect("/today?err=missing_lesson");
  }
  if (!rawText.trim()) {
    redirect(`/lessons/${lessonId}?err=empty_transcript`);
  }

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson || lesson.teacherId !== teacher.id) {
    redirect("/today?err=forbidden");
  }

  await applyTranscriptToLesson({
    lessonId,
    rawText,
    source: "manual",
    tags,
  });

  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/students");
  revalidatePath("/today");

  const provider = getAiProvider();
  const hasKey =
    provider === "deepseek"
      ? Boolean(process.env.DEEPSEEK_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY);
  redirect(`/lessons/${lessonId}?ok=summary${hasKey ? "" : "&warn=no_ai_key"}`);
}

/** Re-run AI summary on the transcript already stored for this lesson. */
export async function regenerateSummaryFromStored(formData: FormData) {
  const teacher = await requireTeacher();
  const lessonId = String(formData.get("lessonId") ?? "");
  if (!lessonId) redirect("/today?err=missing_lesson");

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { transcript: true },
  });
  if (!lesson || lesson.teacherId !== teacher.id) {
    redirect("/today?err=forbidden");
  }

  const rawText = (
    lesson.transcript?.editedText ||
    lesson.transcript?.rawText ||
    ""
  ).trim();
  if (!rawText) {
    redirect(`/lessons/${lessonId}?err=empty_transcript`);
  }

  const source =
    (lesson.transcript?.source as
      | "livekit"
      | "upload"
      | "manual"
      | "drive_import"
      | "meet_import"
      | undefined) ?? "manual";

  await applyTranscriptToLesson({
    lessonId,
    rawText,
    source,
  });

  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/students");
  revalidatePath("/today");
  revalidatePath("/prep");
  redirect(`/lessons/${lessonId}?ok=summary`);
}

export async function approveSummary(formData: FormData) {
  const teacher = await getTeacher();
  const lessonId = String(formData.get("lessonId") ?? "");
  const homework = String(formData.get("homework") ?? "");
  const nextFocus = String(formData.get("nextFocus") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const todaySummary = String(formData.get("todaySummary") ?? "");
  const priorReview = String(formData.get("priorReview") ?? "");

  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { summary: true },
  });
  if (lesson.teacherId !== teacher.id) throw new Error("Not your lesson");

  if (!lesson.summary) throw new Error("No summary");

  await prisma.summary.update({
    where: { lessonId },
    data: {
      homework,
      nextFocus,
      notes,
      todaySummary,
      priorReview,
      approved: true,
    },
  });

  // Materialize homework entity (status source of truth) + vocab quiz
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

  const quiz = buildQuizFromVocab(vocab);
  const instructions =
    homework.trim() ||
    (quiz.length > 0
      ? `Vocabulary quiz · ${quiz.length} questions from today's lesson`
      : "");

  if (instructions || quiz.length > 0) {
    const existingHw = await prisma.homework.findUnique({
      where: { lessonId },
      select: { status: true },
    });
    const keepStatus =
      existingHw?.status === "done" || existingHw?.status === "reviewed"
        ? existingHw.status
        : "assigned";
    const kind = quiz.length > 0 ? "quiz" : "text";
    await prisma.homework.upsert({
      where: { lessonId },
      create: {
        lessonId,
        studentId: lesson.studentId,
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

  for (const v of vocab.slice(0, 20)) {
    if (!v.term) continue;
    await prisma.vocabItem.create({
      data: {
        studentId: lesson.studentId,
        term: v.term,
        reading: v.reading ?? "",
        meaning: v.meaning ?? "",
      },
    });
  }

  for (const g of grammar.slice(0, 20)) {
    if (!g.pattern) continue;
    await prisma.grammarItem.create({
      data: {
        studentId: lesson.studentId,
        pattern: g.pattern,
        notes: g.notes ?? "",
      },
    });
  }

  const topics = parseJsonArray(lesson.summary.topicsJson);
  const existing = await prisma.progressSnapshot.findUnique({
    where: { studentId: lesson.studentId },
  });
  const covered = Array.from(
    new Set([
      ...(existing ? parseJsonArray(existing.topicsCoveredJson) : []),
      ...topics,
    ]),
  );

  await prisma.progressSnapshot.upsert({
    where: { studentId: lesson.studentId },
    create: {
      studentId: lesson.studentId,
      topicsCoveredJson: toJson(covered),
      strengthsJson: toJson([]),
      weaknessesJson: toJson(parseJsonArray(lesson.summary.mistakesJson)),
      attendanceCount: 1,
      note: nextFocus,
    },
    update: {
      topicsCoveredJson: toJson(covered),
      weaknessesJson: toJson(
        Array.from(
          new Set([
            ...(existing ? parseJsonArray(existing.weaknessesJson) : []),
            ...parseJsonArray(lesson.summary.mistakesJson),
          ]),
        ).slice(0, 12),
      ),
      attendanceCount: (existing?.attendanceCount ?? 0) + 1,
      note: nextFocus,
    },
  });

  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath(`/students/${lesson.studentId}`);
  revalidatePath("/student/history");
  revalidatePath(`/student/lessons/${lessonId}`);
}

async function writePrepDraftForLesson(lessonId: string) {
  const teacher = await getTeacher();
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: {
      prepDraft: true,
      student: {
        include: {
          progress: true,
          vocabItems: { orderBy: { createdAt: "desc" }, take: 12 },
          grammarItems: { orderBy: { createdAt: "desc" }, take: 8 },
          lessons: {
            where: {
              status: "completed",
              summary: { is: { approved: true } },
            },
            include: { summary: true },
            orderBy: { startsAt: "desc" },
            take: 3,
          },
        },
      },
    },
  });
  if (lesson.teacherId !== teacher.id) throw new Error("Not your lesson");
  if (
    isCalendarInboxEmail(lesson.student.email) ||
    isCalendarPlaceholderEmail(lesson.student.email)
  ) {
    throw new Error("Assign a student before generating prep");
  }

  const lastTopics = lesson.student.lessons.flatMap((l) =>
    l.summary ? parseJsonArray(l.summary.topicsJson) : [],
  );
  const weaknesses = lesson.student.progress
    ? parseJsonArray(lesson.student.progress.weaknessesJson)
    : [];
  const lastSummary = lesson.student.lessons[0]?.summary ?? null;
  const lastMistakes = lastSummary
    ? parseJsonArray(lastSummary.mistakesJson)
    : [];
  const bankVocab = lesson.student.vocabItems.map((v) => v.term);
  const pastLessons = lesson.student.lessons.map((l) => {
    const focus = l.summary?.nextFocus?.trim();
    const topics = l.summary
      ? parseJsonArray(l.summary.topicsJson).slice(0, 2)
      : [];
    const label = focus || topics.join(" / ") || "past lesson";
    return label;
  });

  const priorNextFocus = lastSummary?.nextFocus?.trim() || "";
  const lastTodaySummary = lastSummary?.todaySummary?.trim() || "";
  let lastLessonVocab: string[] = [];
  if (lastSummary?.vocabJson) {
    try {
      const rows = JSON.parse(lastSummary.vocabJson) as Array<{
        term?: string;
      }>;
      if (Array.isArray(rows)) {
        lastLessonVocab = rows
          .map((v) => String(v?.term ?? "").trim())
          .filter(Boolean);
      }
    } catch {
      lastLessonVocab = [];
    }
  }
  // Prefer last-lesson + weak-point vocab for cloze recall, then bank terms.
  const vocab = [
    ...lastLessonVocab,
    ...lastMistakes
      .map((w) => w.replace(/^「(.+?)」.*/, "$1").trim())
      .filter((w) => w && !w.includes("→")),
    ...weaknesses
      .map((w) => w.replace(/^「(.+?)」.*/, "$1").trim())
      .filter((w) => w && !w.includes("→")),
    ...bankVocab,
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  const priorBoardLesson = await prisma.lesson.findFirst({
    where: {
      studentId: lesson.studentId,
      id: { not: lessonId },
      status: { in: ["completed", "scheduled", "in_progress"] },
      classroomDoc: { not: "" },
    },
    orderBy: { startsAt: "desc" },
    select: { classroomDoc: true },
  });
  const lastClassroomBoard = tiptapDocToPlainText(
    parseClassroomDoc(priorBoardLesson?.classroomDoc),
  );

  const generated = await generatePrepDraft({
    studentName: lesson.student.name,
    level: lesson.student.level,
    courseType: lesson.student.courseType,
    goals: lesson.student.goals,
    lastTopics,
    weaknesses,
    mistakes: lastMistakes,
    vocab,
    lastClassroomBoard,
    priorNextFocus,
    lastTodaySummary,
    isFirstLesson: !lastSummary,
  });
  const { vocabRecall: generatedCloze, ...draft } = generated;

  const existingRefs = parsePrepRefs(lesson.prepDraft?.refsJson);
  const priorLesson = await prisma.lesson.findFirst({
    where: {
      studentId: lesson.studentId,
      id: { not: lessonId },
      startsAt: { lt: lesson.startsAt },
    },
    orderBy: { startsAt: "desc" },
    include: { prepDraft: true },
  });
  const priorRefs = parsePrepRefs(priorLesson?.prepDraft?.refsJson);
  const thisCloze =
    existingRefs.vocabRecall.length > 0
      ? existingRefs.vocabRecall
      : priorRefs.nextVocabRecall;

  const refs: PrepRefs = {
    course: courseTypeLabel(lesson.student.courseType),
    level: lesson.student.level,
    goals: lesson.student.goals?.trim() || "",
    pastLessons,
    topics: [...new Set(lastTopics)].slice(0, 8),
    weaknesses: [...lastMistakes, ...weaknesses].slice(0, 8),
    vocab: vocab.slice(0, 10),
    vocabRecall: thisCloze,
    nextVocabRecall: generatedCloze ?? [],
  };

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: { lessonId, ...draft, refsJson: toJson(refs), status: "draft" },
    update: { ...draft, refsJson: toJson(refs), status: "draft" },
  });

  await pushClozeToNextLesson({
    studentId: lesson.studentId,
    afterStartsAt: lesson.startsAt,
    exceptLessonId: lessonId,
    cloze: generatedCloze ?? [],
  });

  const bound = bindClassroomDocToPrep(
    parseClassroomDoc(lesson.classroomDoc),
    thisCloze,
  );
  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      prepStatus: "draft",
      ...(bound.changed
        ? { classroomDoc: serializeClassroomDoc(bound.doc) }
        : {}),
    },
  });

  return { lessonId, draft, refs };
}

async function pushClozeToNextLesson(opts: {
  studentId: string;
  afterStartsAt: Date;
  exceptLessonId: string;
  cloze: VocabRecallItem[];
}) {
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
  if (!next) return;

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
  const bound = bindClassroomDocToPrep(
    parseClassroomDoc(next.classroomDoc),
    opts.cloze,
  );
  if (bound.changed) {
    await prisma.lesson.update({
      where: { id: next.id },
      data: { classroomDoc: serializeClassroomDoc(bound.doc) },
    });
  }
  revalidatePath(`/classroom/${next.id}`);
  revalidatePath(`/lessons/${next.id}`);
}

function revalidatePrepSurfaces(lessonIds: string[] = []) {
  revalidatePath("/prep");
  revalidatePath("/today");
  revalidatePath("/calendar");
  for (const id of lessonIds) {
    revalidatePath(`/lessons/${id}`);
    revalidatePath(`/classroom/${id}`);
  }
}

async function maybeWritePrepIfEmpty(lessonId: string) {
  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { prepDraft: true, student: true },
    });
    if (!lesson) return;
    if (
      isCalendarInboxEmail(lesson.student.email) ||
      isCalendarPlaceholderEmail(lesson.student.email)
    ) {
      return;
    }
    const existing = lesson.prepDraft;
    const hasContent = Boolean(
      existing &&
      (existing.warmup.trim() ||
        existing.review.trim() ||
        existing.newFocus.trim() ||
        existing.practice.trim() ||
        existing.homeworkSeed.trim()),
    );
    if (hasContent) return;
    await writePrepDraftForLesson(lessonId);
  } catch (err) {
    console.error("First prep failed", err);
  }
}

export async function generateLessonPrep(lessonId: string) {
  const result = await writePrepDraftForLesson(lessonId);
  revalidatePrepSurfaces([lessonId]);
  return result;
}

/** Fill missing prep drafts for upcoming lessons. Processes a small batch to stay within serverless time limits. */
export async function generateMissingPrepBatch(lessonIds: string[]) {
  const teacher = await getTeacher();
  const uniqueIds = [...new Set(lessonIds.filter(Boolean))].slice(0, 4);
  if (uniqueIds.length === 0) {
    return {
      generated: [] as Awaited<ReturnType<typeof writePrepDraftForLesson>>[],
      skipped: 0,
    };
  }

  const owned = await prisma.lesson.findMany({
    where: { id: { in: uniqueIds }, teacherId: teacher.id },
    include: { prepDraft: true },
  });
  const byId = new Map(owned.map((l) => [l.id, l]));

  const generated: Awaited<ReturnType<typeof writePrepDraftForLesson>>[] = [];
  let skipped = 0;

  for (const id of uniqueIds) {
    const lesson = byId.get(id);
    if (!lesson) {
      skipped += 1;
      continue;
    }
    const existing = lesson.prepDraft;
    const hasContent = Boolean(
      existing &&
      (existing.warmup.trim() ||
        existing.review.trim() ||
        existing.newFocus.trim() ||
        existing.practice.trim() ||
        existing.homeworkSeed.trim()),
    );
    if (hasContent) {
      skipped += 1;
      continue;
    }
    try {
      generated.push(await writePrepDraftForLesson(id));
    } catch {
      skipped += 1;
    }
  }

  if (generated.length > 0) {
    revalidatePrepSurfaces(generated.map((g) => g.lessonId));
  }

  return { generated, skipped };
}

export async function savePrepDraft(formData: FormData) {
  const teacher = await getTeacher();
  const lessonId = String(formData.get("lessonId") ?? "");
  const status = String(formData.get("status") ?? "draft");
  const data = {
    warmup: String(formData.get("warmup") ?? ""),
    review: String(formData.get("review") ?? ""),
    newFocus: String(formData.get("newFocus") ?? ""),
    practice: String(formData.get("practice") ?? ""),
    homeworkSeed: String(formData.get("homeworkSeed") ?? ""),
    status,
  };

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { prepDraft: true },
  });
  if (!lesson || lesson.teacherId !== teacher.id) {
    throw new Error("Not your lesson");
  }

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: { lessonId, ...data },
    update: data,
  });
  const cloze = parsePrepRefs(lesson.prepDraft?.refsJson).vocabRecall;
  const bound = bindClassroomDocToPrep(
    parseClassroomDoc(lesson.classroomDoc),
    cloze,
  );
  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      prepStatus: status === "ready" ? "ready" : "draft",
      ...(bound.changed
        ? { classroomDoc: serializeClassroomDoc(bound.doc) }
        : {}),
    },
  });

  revalidatePath("/prep");
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath(`/classroom/${lessonId}`);
  revalidatePath(`/students/${lesson.studentId}`);
}

export async function updateAvailability(formData: FormData) {
  const teacher = await getTeacher();
  const timezone = normalizeTimezone(
    String(formData.get("timezone") ?? teacher.timezone ?? "Asia/Tokyo"),
  );
  await prisma.availabilityRule.upsert({
    where: { teacherId: teacher.id },
    create: {
      teacherId: teacher.id,
      startTime: String(formData.get("startTime") ?? "10:00"),
      endTime: String(formData.get("endTime") ?? "20:00"),
      minNoticeHours: Number(formData.get("minNoticeHours") ?? 24),
      maxWeeklyLessons: Number(formData.get("maxWeeklyLessons") ?? 6),
      weekdaysJson: String(formData.get("weekdaysJson") ?? "[1,2,3,4,5,6]"),
      slotMinutes: LESSON_MINUTES,
      timezone,
    },
    update: {
      startTime: String(formData.get("startTime") ?? "10:00"),
      endTime: String(formData.get("endTime") ?? "20:00"),
      minNoticeHours: Number(formData.get("minNoticeHours") ?? 24),
      maxWeeklyLessons: Number(formData.get("maxWeeklyLessons") ?? 6),
      weekdaysJson: String(formData.get("weekdaysJson") ?? "[1,2,3,4,5,6]"),
      slotMinutes: LESSON_MINUTES,
      timezone,
    },
  });
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { timezone },
  });
  revalidatePath("/availability");
  revalidatePath("/student/book");
  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function saveTeacherTimezone(formData: FormData) {
  const teacher = await getTeacher();
  const timezone = normalizeTimezone(
    String(formData.get("timezone") ?? "Asia/Tokyo"),
  );
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { timezone },
  });
  await prisma.availabilityRule.upsert({
    where: { teacherId: teacher.id },
    create: { teacherId: teacher.id, timezone },
    update: { timezone },
  });
  revalidatePath("/settings");
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/availability");
  revalidatePath("/student/book");
  redirect("/settings?saved=timezone");
}

export async function addBlackoutDate(formData: FormData) {
  const teacher = await getTeacher();
  const dateStr = String(formData.get("date") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const date = blackoutDateFromYmd(dateStr, teacher.timezone);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid blackout date");

  await prisma.blackoutDate.create({
    data: { teacherId: teacher.id, date, reason },
  });
  revalidatePath("/availability");
  revalidatePath("/student/book");
}

export async function removeBlackoutDate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await prisma.blackoutDate.delete({ where: { id } });
  revalidatePath("/availability");
  revalidatePath("/student/book");
}

export async function decideBooking(formData: FormData) {
  const teacher = await requireTeacher();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const request = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id },
    include: { student: true },
  });
  if (request.teacherId !== teacher.id) throw new Error("Not your booking");

  if (decision === "approve") {
    const conflict = await prisma.lesson.findFirst({
      where: {
        teacherId: request.teacherId,
        status: { not: "cancelled" },
        startsAt: { lt: request.requestedEnd },
        endsAt: { gt: request.requestedStart },
        ...(request.lessonId ? { id: { not: request.lessonId } } : {}),
      },
    });
    if (conflict) {
      throw new Error("Time conflict with an existing lesson");
    }

    await prisma.bookingRequest.update({
      where: { id },
      data: { status: "approved" },
    });

    if (request.type === "reschedule" && request.lessonId) {
      await prisma.lesson.update({
        where: { id: request.lessonId },
        data: {
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
        },
      });
    } else if (request.type === "book") {
      const created = await prisma.lesson.create({
        data: {
          teacherId: request.teacherId,
          studentId: request.studentId,
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
          status: "scheduled",
          prepStatus: "none",
          transcriptStatus: "none",
        },
      });
      await maybeWritePrepIfEmpty(created.id);
    }
  } else {
    await prisma.bookingRequest.update({
      where: { id },
      data: { status: "declined" },
    });
  }

  try {
    await notifyBookingDecision({
      teacher,
      studentEmail: request.student.email,
      studentName: request.student.name,
      requestedStart: request.requestedStart,
      approved: decision === "approve",
    });
  } catch (err) {
    console.error("Booking decision email failed", err);
  }

  revalidatePath("/availability");
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath("/student");
  revalidatePath("/student/book");
}

/** Teacher schedules a 60-minute lesson directly from the calendar. */
export async function createLessonForStudent(formData: FormData) {
  const teacher = await requireTeacher();
  const studentId = String(formData.get("studentId") ?? "");
  const startsAtRaw = String(formData.get("startsAt") ?? "");
  const returnStart = String(formData.get("returnStart") ?? "");
  const calendarHref = returnStart
    ? `/calendar?view=days&start=${encodeURIComponent(returnStart)}`
    : "/calendar?view=days";

  const start = parseIsoOrLocal(startsAtRaw);
  if (!studentId || Number.isNaN(start.getTime())) {
    redirect(`${calendarHref}&err=schedule`);
  }

  const teacherRow = await prisma.teacher.findUniqueOrThrow({
    where: { id: teacher.id },
  });
  const tz = normalizeTimezone(teacherRow.timezone);
  const minute = formatInTz(start, "mm", tz);
  if (minute !== "00" && minute !== "30") {
    redirect(`${calendarHref}&err=schedule`);
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, teacherId: teacher.id, archivedAt: null },
  });
  if (
    !student ||
    isCalendarInboxEmail(student.email) ||
    isCalendarPlaceholderEmail(student.email)
  ) {
    redirect(`${calendarHref}&err=schedule`);
  }

  const endsAt = addMinutes(start, LESSON_MINUTES);
  const googleBusy = await listGoogleBusyIntervals(teacherRow, start, endsAt);
  if (googleBusy.some((b) => intervalsOverlap(start, endsAt, b.start, b.end))) {
    redirect(`${calendarHref}&err=conflict`);
  }

  const conflict = await prisma.lesson.findFirst({
    where: {
      teacherId: teacher.id,
      status: { not: "cancelled" },
      startsAt: { lt: endsAt },
      endsAt: { gt: start },
    },
  });
  if (conflict) {
    redirect(`${calendarHref}&err=conflict`);
  }

  const created = await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      studentId: student.id,
      startsAt: start,
      endsAt,
      status: "scheduled",
      prepStatus: "none",
      transcriptStatus: "none",
    },
  });
  await maybeWritePrepIfEmpty(created.id);

  revalidatePath("/availability");
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath("/student");
  revalidatePath("/students");
  redirect(`${calendarHref}&ok=scheduled`);
}

export async function createBookingRequest(formData: FormData) {
  const student = await requireStudent();
  const teacher = await prisma.teacher.findUniqueOrThrow({
    where: { id: student.teacherId },
  });
  const type = String(formData.get("type") ?? "book");
  const start = parseIsoOrLocal(String(formData.get("requestedStart") ?? ""));
  const note = String(formData.get("note") ?? "");
  if (Number.isNaN(start.getTime())) throw new Error("Invalid start time");

  const tz = normalizeTimezone(teacher.timezone);
  const minute = formatInTz(start, "mm", tz);
  if (minute !== "00" && minute !== "30") {
    throw new Error(
      "Lessons must start on the hour or half-hour (e.g. 15:00 / 15:30)",
    );
  }

  const requestedEnd = addMinutes(start, LESSON_MINUTES);
  const googleBusy = await listGoogleBusyIntervals(
    teacher,
    start,
    requestedEnd,
  );
  if (
    googleBusy.some((b) =>
      intervalsOverlap(start, requestedEnd, b.start, b.end),
    )
  ) {
    throw new Error("That time is busy on Google Calendar");
  }

  await prisma.bookingRequest.create({
    data: {
      teacherId: teacher.id,
      studentId: student.id,
      type,
      requestedStart: start,
      requestedEnd,
      note,
      status: "pending",
      lessonId:
        type === "reschedule"
          ? String(formData.get("lessonId") || "") || null
          : null,
    },
  });

  try {
    await notifyBookingSubmitted({
      teacher,
      studentName: student.name,
      requestedStart: start,
    });
  } catch (err) {
    console.error("Booking request email failed", err);
  }

  revalidatePath("/student/book");
  revalidatePath("/student");
  revalidatePath("/availability");
  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function cancelBookingRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const student = await requireStudent();
  const booking = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id },
  });
  if (booking.studentId !== student.id) throw new Error("Not your booking");
  if (booking.status !== "pending")
    throw new Error("Only pending requests can be cancelled");

  await prisma.bookingRequest.update({
    where: { id },
    data: { status: "cancelled" },
  });
  revalidatePath("/student/book");
  revalidatePath("/student");
  revalidatePath("/availability");
  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function createStudent(formData: FormData) {
  const teacher = await getTeacher();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const level = String(formData.get("level") ?? "N4");
  const courseType = String(formData.get("courseType") ?? "jlpt_n4");
  const goals = String(formData.get("goals") ?? "");
  const recordingConsent = formData.get("recordingConsent") === "on";

  if (!name || !email) throw new Error("Name and email are required");
  if (password.length < 4)
    throw new Error("Password must be at least 4 characters");

  const passwordHash = await hashPassword(password);
  const student = await prisma.student.create({
    data: {
      teacherId: teacher.id,
      name,
      email,
      passwordHash,
      level,
      courseType,
      goals,
      recordingConsent,
    },
  });

  await ensureSampleLevelHomework({
    studentId: student.id,
    level,
    courseType,
  });

  const firstLesson = await prisma.lesson.findFirst({
    where: {
      studentId: student.id,
      status: { in: ["scheduled", "in_progress"] },
    },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
  if (firstLesson) {
    await maybeWritePrepIfEmpty(firstLesson.id);
  }

  revalidatePath("/students");
  redirect(`/students?student=${student.id}`);
}

export async function updateStudent(formData: FormData) {
  const teacher = await getTeacher();
  const studentId = String(formData.get("studentId") ?? "");
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.teacherId !== teacher.id) {
    throw new Error("Not your student");
  }

  const priceRaw = String(formData.get("pricePerLesson") ?? "").trim();
  const pricePerLesson =
    priceRaw === "" ? null : Number.parseFloat(priceRaw.replace(/,/g, ""));
  const currency = String(formData.get("currency") ?? "JPY").trim() || "JPY";
  const lessonsPerWeekRaw = String(formData.get("lessonsPerWeek") ?? "").trim();
  const lessonsPerWeek =
    lessonsPerWeekRaw === "" ? null : Number.parseInt(lessonsPerWeekRaw, 10);
  const startedAtRaw = String(formData.get("startedAt") ?? "").trim();
  const startedAt = startedAtRaw ? new Date(`${startedAtRaw}T00:00:00`) : null;
  const priceNote = String(formData.get("priceNote") ?? "");
  const newPassword = String(formData.get("password") ?? "");

  let priceHistoryJson = student.priceHistoryJson || "[]";
  if (
    pricePerLesson != null &&
    !Number.isNaN(pricePerLesson) &&
    pricePerLesson !== student.pricePerLesson
  ) {
    let history: Array<{ at: string; price: number; currency?: string }> = [];
    try {
      const parsed = JSON.parse(priceHistoryJson) as unknown;
      if (Array.isArray(parsed)) history = parsed as typeof history;
    } catch {
      history = [];
    }
    if (student.pricePerLesson != null) {
      history.push({
        at: new Date().toISOString(),
        price: student.pricePerLesson,
        currency: student.currency || "JPY",
      });
    }
    priceHistoryJson = toJson(history.slice(-20));
  }

  const passwordData =
    newPassword.length >= 4
      ? { passwordHash: await hashPassword(newPassword) }
      : {};

  await prisma.student.update({
    where: { id: studentId },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "")
        .trim()
        .toLowerCase(),
      goals: String(formData.get("goals") ?? ""),
      privateNotes: String(formData.get("privateNotes") ?? ""),
      level: String(formData.get("level") ?? "N4"),
      courseType: String(formData.get("courseType") ?? "jlpt_n4"),
      recordingConsent: formData.get("recordingConsent") === "on",
      startedAt:
        startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
      pricePerLesson:
        pricePerLesson != null && !Number.isNaN(pricePerLesson)
          ? pricePerLesson
          : null,
      currency,
      lessonsPerWeek:
        lessonsPerWeek != null && !Number.isNaN(lessonsPerWeek)
          ? lessonsPerWeek
          : null,
      priceNote,
      priceHistoryJson,
      ...passwordData,
    },
  });
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
  redirect(`/students?student=${studentId}`);
}

export async function archiveStudent(formData: FormData) {
  const teacher = await getTeacher();
  const studentId = String(formData.get("studentId") ?? "");
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.teacherId !== teacher.id) {
    throw new Error("Not your student");
  }
  await prisma.student.update({
    where: { id: studentId },
    data: {
      archivedAt: new Date(),
      inviteToken: null,
      inviteTokenExpiresAt: null,
    },
  });
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  redirect("/students");
}

export async function restoreStudent(formData: FormData) {
  const teacher = await getTeacher();
  const studentId = String(formData.get("studentId") ?? "");
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.teacherId !== teacher.id) {
    throw new Error("Not your student");
  }
  await prisma.student.update({
    where: { id: studentId },
    data: { archivedAt: null },
  });
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
}

export async function regenerateInviteToken(formData: FormData) {
  const teacher = await getTeacher();
  const studentId = String(formData.get("studentId") ?? "");
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.teacherId !== teacher.id) {
    throw new Error("Not your student");
  }
  await prisma.student.update({
    where: { id: studentId },
    data: {
      inviteToken: createInviteToken(),
      inviteTokenExpiresAt: inviteExpiry(90),
    },
  });
  revalidatePath(`/students/${studentId}`);
}

export async function markHomeworkDone(formData: FormData) {
  const student = await requireStudent();
  const homeworkId = String(formData.get("homeworkId") ?? "");
  const hw = await prisma.homework.findUnique({ where: { id: homeworkId } });
  if (!hw || hw.studentId !== student.id) {
    throw new Error("Not your homework");
  }
  await prisma.homework.update({
    where: { id: homeworkId },
    data: { status: "done", completedAt: new Date() },
  });
  revalidatePath("/student");
  revalidatePath("/student/homework");
  revalidatePath("/student/history");
  revalidatePath(`/student/homework/${hw.id}`);
  if (hw.lessonId) {
    revalidatePath(`/student/lessons/${hw.lessonId}`);
    revalidatePath(`/lessons/${hw.lessonId}`);
  }
  revalidatePath(`/students/${hw.studentId}`);
}

export async function submitHomeworkQuiz(formData: FormData) {
  const student = await requireStudent();
  const homeworkId = String(formData.get("homeworkId") ?? "");
  const answersRaw = String(formData.get("answersJson") ?? "[]");

  const hw = await prisma.homework.findUnique({
    where: { id: homeworkId },
    include: { lesson: { select: { id: true, startsAt: true } } },
  });
  if (!hw || hw.studentId !== student.id) {
    throw new Error("Not your homework");
  }
  if (hw.kind !== "quiz") {
    throw new Error("Not a quiz homework");
  }

  const questions = parseQuizJson(hw.quizJson);
  const answers = parseAnswersJson(answersRaw);
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error("Missing answers");
  }
  const score = scoreQuiz(questions, answers);

  await prisma.homework.update({
    where: { id: homeworkId },
    data: {
      answersJson: serializeAnswers(answers),
      score,
      status: "done",
      completedAt: new Date(),
    },
  });

  revalidatePath("/student");
  revalidatePath("/student/homework");
  revalidatePath("/student/history");
  revalidatePath(`/student/homework/${hw.id}`);
  revalidatePath(`/students/${hw.studentId}`);
  if (hw.lessonId) {
    revalidatePath(`/student/lessons/${hw.lessonId}`);
    revalidatePath(`/lessons/${hw.lessonId}`);
  }
  redirect(`/student/homework/${hw.id}?ok=done`);
}

export async function retryHomeworkQuiz(formData: FormData) {
  const student = await requireStudent();
  const homeworkId = String(formData.get("homeworkId") ?? "");
  const hw = await prisma.homework.findUnique({ where: { id: homeworkId } });
  if (!hw || hw.studentId !== student.id) {
    throw new Error("Not your homework");
  }
  if (hw.kind !== "quiz") {
    throw new Error("Not a quiz homework");
  }
  await prisma.homework.update({
    where: { id: homeworkId },
    data: {
      answersJson: "[]",
      score: null,
      status: "assigned",
      completedAt: null,
    },
  });
  revalidatePath("/student");
  revalidatePath("/student/homework");
  revalidatePath("/student/history");
  revalidatePath(`/student/homework/${hw.id}`);
  revalidatePath(`/students/${hw.studentId}`);
  if (hw.lessonId) {
    revalidatePath(`/student/lessons/${hw.lessonId}`);
    revalidatePath(`/lessons/${hw.lessonId}`);
  }
  redirect(`/student/homework/${hw.id}`);
}

export async function markHomeworkReviewed(formData: FormData) {
  const teacher = await getTeacher();
  const homeworkId = String(formData.get("homeworkId") ?? "");
  const hw = await prisma.homework.findUnique({
    where: { id: homeworkId },
    include: {
      lesson: { select: { teacherId: true } },
      student: { select: { teacherId: true } },
    },
  });
  if (!hw || hw.student.teacherId !== teacher.id) {
    throw new Error("Not your homework");
  }
  await prisma.homework.update({
    where: { id: homeworkId },
    data: { status: "reviewed" },
  });
  revalidatePath(`/students/${hw.studentId}`);
  if (hw.lessonId) {
    revalidatePath(`/lessons/${hw.lessonId}`);
  }
}

function calendarReturnHref(formData: FormData) {
  const returnStart = String(formData.get("returnStart") ?? "");
  const view = String(formData.get("view") ?? "days");
  const qs = new URLSearchParams();
  if (view === "month") qs.set("view", "month");
  else qs.set("view", "days");
  if (returnStart) qs.set("start", returnStart);
  const q = qs.toString();
  return q ? `/calendar?${q}` : "/calendar";
}

export async function syncGoogleCalendar() {
  const teacher = await requireTeacher();
  const result = await syncTeacherCalendar(teacher.id);
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/prep");
  revalidatePath("/student/book");
  if (!result.ok) {
    const reason = result.reason === "not_connected" ? "not_connected" : "sync";
    redirect(`/calendar?err=${reason}`);
  }
  redirect("/calendar?ok=synced");
}

export async function bindCalendarLessonStudent(formData: FormData) {
  const teacher = await requireTeacher();
  const href = calendarReturnHref(formData);
  const lessonId = String(formData.get("lessonId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  if (!lessonId || !studentId) {
    redirect(`${href}&err=bind`);
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { student: true },
  });
  if (!lesson || lesson.teacherId !== teacher.id) {
    redirect(`${href}&err=bind`);
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, teacherId: teacher.id, archivedAt: null },
  });
  if (
    !student ||
    isCalendarInboxEmail(student.email) ||
    isCalendarPlaceholderEmail(student.email)
  ) {
    redirect(`${href}&err=bind`);
  }

  const tags = parseJsonArray(lesson.tagsJson).filter(
    (t) => t !== "unassigned",
  );
  await prisma.lesson.update({
    where: { id: lesson.id },
    data: { studentId: student.id, tagsJson: toJson(tags) },
  });

  await maybeWritePrepIfEmpty(lesson.id);

  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/students");
  revalidatePath("/prep");
  redirect(`${href}&ok=bound`);
}

export async function createStudentForCalendarLesson(formData: FormData) {
  const teacher = await requireTeacher();
  const href = calendarReturnHref(formData);
  const lessonId = String(formData.get("lessonId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const level = String(formData.get("level") ?? "N4");
  const courseTypeRaw = String(formData.get("courseType") ?? "jlpt_n4");
  const courseType = COURSE_TYPES.some((c) => c.value === courseTypeRaw)
    ? courseTypeRaw
    : "custom";

  if (!lessonId || !name || !email || password.length < 4) {
    redirect(`${href}&err=student`);
  }

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson || lesson.teacherId !== teacher.id) {
    redirect(`${href}&err=bind`);
  }

  const taken = await prisma.student.findFirst({
    where: { teacherId: teacher.id, email },
  });
  if (taken) {
    redirect(`${href}&err=student_exists`);
  }

  const student = await prisma.student.create({
    data: {
      teacherId: teacher.id,
      name,
      email,
      passwordHash: await hashPassword(password),
      level,
      courseType,
      recordingConsent: false,
    },
  });

  await ensureSampleLevelHomework({
    studentId: student.id,
    level,
    courseType,
  });

  const tags = parseJsonArray(lesson.tagsJson).filter(
    (t) => t !== "unassigned",
  );
  await prisma.lesson.update({
    where: { id: lesson.id },
    data: { studentId: student.id, tagsJson: toJson(tags) },
  });

  await maybeWritePrepIfEmpty(lesson.id);

  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/students");
  revalidatePath("/prep");
  redirect(`${href}&ok=bound`);
}
