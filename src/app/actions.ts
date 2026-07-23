"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addMinutes } from "date-fns";
import { generatePrepDraft, summarizeTranscript } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { LESSON_MINUTES } from "@/lib/scheduling";
import { DEMO_STUDENT_EMAIL, DEMO_TEACHER_EMAIL, type AppRole } from "@/lib/session";
import { parseJsonArray, toJson } from "@/lib/utils";

export async function setRole(role: AppRole) {
  const jar = await cookies();
  jar.set("ayanote_role", role, { path: "/" });
  redirect(role === "teacher" ? "/today" : "/student");
}

export async function setLocale(locale: "ja" | "en") {
  const jar = await cookies();
  jar.set("ayanote_locale", locale, { path: "/" });
  revalidatePath("/", "layout");
}

async function getTeacher() {
  return prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
}

async function getDemoStudent() {
  return prisma.student.findFirstOrThrow({ where: { email: DEMO_STUDENT_EMAIL } });
}

export async function importTranscriptAndSummarize(formData: FormData) {
  const lessonId = String(formData.get("lessonId") ?? "");
  const rawText = String(formData.get("transcript") ?? "");
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!lessonId || !rawText.trim()) {
    throw new Error("Lesson and transcript are required");
  }

  const summary = await summarizeTranscript(rawText);

  await prisma.lesson.update({
    where: { id: lessonId },
    data: {
      status: "completed",
      tagsJson: toJson(tags),
      transcript: {
        upsert: {
          create: { source: "meet_import", rawText, editedText: rawText },
          update: { source: "meet_import", rawText, editedText: rawText },
        },
      },
      summary: {
        upsert: {
          create: {
            topicsJson: toJson(summary.topics),
            vocabJson: toJson(summary.vocab),
            grammarJson: toJson(summary.grammar),
            mistakesJson: toJson(summary.mistakes),
            homework: summary.homework,
            nextFocus: summary.nextFocus,
            notes: summary.notes,
            approved: false,
          },
          update: {
            topicsJson: toJson(summary.topics),
            vocabJson: toJson(summary.vocab),
            grammarJson: toJson(summary.grammar),
            mistakesJson: toJson(summary.mistakes),
            homework: summary.homework,
            nextFocus: summary.nextFocus,
            notes: summary.notes,
            approved: false,
          },
        },
      },
    },
  });

  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/students");
  revalidatePath("/today");
}

export async function approveSummary(formData: FormData) {
  const lessonId = String(formData.get("lessonId") ?? "");
  const homework = String(formData.get("homework") ?? "");
  const nextFocus = String(formData.get("nextFocus") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: { summary: true },
  });

  if (!lesson.summary) throw new Error("No summary");

  await prisma.summary.update({
    where: { lessonId },
    data: { homework, nextFocus, notes, approved: true },
  });

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
  const covered = Array.from(new Set([...(existing ? parseJsonArray(existing.topicsCoveredJson) : []), ...topics]));

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
}

export async function generateLessonPrep(lessonId: string) {
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    include: {
      student: {
        include: {
          progress: true,
          vocabItems: { orderBy: { createdAt: "desc" }, take: 12 },
          lessons: {
            where: { status: "completed" },
            include: { summary: true },
            orderBy: { startsAt: "desc" },
            take: 3,
          },
        },
      },
    },
  });

  const lastTopics = lesson.student.lessons.flatMap((l) =>
    l.summary ? parseJsonArray(l.summary.topicsJson) : [],
  );
  const weaknesses = lesson.student.progress
    ? parseJsonArray(lesson.student.progress.weaknessesJson)
    : [];

  const draft = await generatePrepDraft({
    studentName: lesson.student.name,
    level: lesson.student.level,
    goals: lesson.student.goals,
    lastTopics,
    weaknesses,
    vocab: lesson.student.vocabItems.map((v) => v.term),
  });

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: { lessonId, ...draft, status: "draft" },
    update: { ...draft, status: "draft" },
  });

  await prisma.lesson.update({
    where: { id: lessonId },
    data: { prepStatus: "draft" },
  });

  revalidatePath("/prep");
  revalidatePath("/today");
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/calendar");
}

export async function savePrepDraft(formData: FormData) {
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

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: { lessonId, ...data },
    update: data,
  });
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { prepStatus: status === "ready" ? "ready" : "draft" },
  });

  revalidatePath("/prep");
  revalidatePath("/today");
  revalidatePath("/calendar");
}

export async function updateAvailability(formData: FormData) {
  const teacher = await getTeacher();
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
    },
    update: {
      startTime: String(formData.get("startTime") ?? "10:00"),
      endTime: String(formData.get("endTime") ?? "20:00"),
      minNoticeHours: Number(formData.get("minNoticeHours") ?? 24),
      maxWeeklyLessons: Number(formData.get("maxWeeklyLessons") ?? 6),
      weekdaysJson: String(formData.get("weekdaysJson") ?? "[1,2,3,4,5,6]"),
      slotMinutes: LESSON_MINUTES,
    },
  });
  revalidatePath("/availability");
  revalidatePath("/student/book");
}

export async function decideBooking(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const request = await prisma.bookingRequest.findUniqueOrThrow({ where: { id } });

  if (decision === "approve") {
    await prisma.bookingRequest.update({ where: { id }, data: { status: "approved" } });
    if (request.type === "reschedule" && request.lessonId) {
      await prisma.lesson.update({
        where: { id: request.lessonId },
        data: {
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
        },
      });
    } else if (request.type === "book") {
      await prisma.lesson.create({
        data: {
          teacherId: request.teacherId,
          studentId: request.studentId,
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
          status: "scheduled",
          prepStatus: "none",
        },
      });
    }
  } else {
    await prisma.bookingRequest.update({ where: { id }, data: { status: "declined" } });
  }

  revalidatePath("/availability");
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath("/student");
  revalidatePath("/student/book");
}

export async function createBookingRequest(formData: FormData) {
  const teacher = await getTeacher();
  const student = await getDemoStudent();
  const type = String(formData.get("type") ?? "book");
  const start = new Date(String(formData.get("requestedStart") ?? ""));
  const note = String(formData.get("note") ?? "");
  if (Number.isNaN(start.getTime())) throw new Error("Invalid start time");

  const minutes = start.getMinutes();
  if (minutes !== 0 && minutes !== 30) {
    throw new Error("Lessons must start on the hour or half-hour (e.g. 15:00 / 15:30)");
  }

  await prisma.bookingRequest.create({
    data: {
      teacherId: teacher.id,
      studentId: student.id,
      type,
      requestedStart: start,
      requestedEnd: addMinutes(start, LESSON_MINUTES),
      note,
      status: "pending",
      lessonId: type === "reschedule" ? String(formData.get("lessonId") || "") || null : null,
    },
  });

  revalidatePath("/student/book");
  revalidatePath("/availability");
  revalidatePath("/calendar");
}

export async function updateStudentNotes(formData: FormData) {
  const studentId = String(formData.get("studentId") ?? "");
  await prisma.student.update({
    where: { id: studentId },
    data: {
      goals: String(formData.get("goals") ?? ""),
      privateNotes: String(formData.get("privateNotes") ?? ""),
      level: String(formData.get("level") ?? "N4"),
      recordingConsent: formData.get("recordingConsent") === "on",
    },
  });
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
}
