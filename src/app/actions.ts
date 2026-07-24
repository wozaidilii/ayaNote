"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addMinutes } from "date-fns";
import { generatePrepDraft, summarizeTranscript } from "@/lib/ai";
import { prisma } from "@/lib/db";
import {
  createCalendarMeetEvent,
  getValidAccessToken,
  updateCalendarEvent,
} from "@/lib/google";
import { createInviteToken, inviteExpiry } from "@/lib/invite";
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
  return prisma.student.findFirstOrThrow({
    where: { email: DEMO_STUDENT_EMAIL, archivedAt: null },
  });
}

async function teacherAccessToken(teacherId: string) {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
  const token = await getValidAccessToken(teacher);
  if (
    token &&
    teacher.googleRefreshToken &&
    (!teacher.googleAccessToken ||
      !teacher.googleTokenExpiry ||
      teacher.googleTokenExpiry.getTime() <= Date.now() + 60_000)
  ) {
    await prisma.teacher.update({
      where: { id: teacherId },
      data: {
        googleAccessToken: token,
        googleTokenExpiry: new Date(Date.now() + 3500_000),
      },
    });
  }
  return token;
}

async function attachMeetToLesson(opts: {
  lessonId: string;
  teacherId: string;
  studentName: string;
  studentEmail: string;
  startsAt: Date;
  endsAt: Date;
}) {
  const accessToken = await teacherAccessToken(opts.teacherId);
  const meet = await createCalendarMeetEvent({
    accessToken,
    summary: `AyaNote · ${opts.studentName}`,
    description: "Japanese lesson via AyaNote",
    start: opts.startsAt,
    end: opts.endsAt,
    attendeeEmail: opts.studentEmail,
    fallbackId: opts.lessonId,
  });
  await prisma.lesson.update({
    where: { id: opts.lessonId },
    data: {
      meetLink: meet.meetLink,
      calendarEventId: meet.calendarEventId,
      transcriptStatus: "waiting_drive",
    },
  });
  return meet;
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
      transcriptStatus: "manual",
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

export async function addBlackoutDate(formData: FormData) {
  const teacher = await getTeacher();
  const dateStr = String(formData.get("date") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const date = new Date(`${dateStr}T00:00:00`);
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
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const request = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id },
    include: { student: true },
  });

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

    await prisma.bookingRequest.update({ where: { id }, data: { status: "approved" } });

    if (request.type === "reschedule" && request.lessonId) {
      const lesson = await prisma.lesson.update({
        where: { id: request.lessonId },
        data: {
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
        },
      });
      const accessToken = await teacherAccessToken(request.teacherId);
      if (accessToken && lesson.calendarEventId) {
        await updateCalendarEvent({
          accessToken,
          eventId: lesson.calendarEventId,
          start: request.requestedStart,
          end: request.requestedEnd,
        });
      } else {
        await attachMeetToLesson({
          lessonId: lesson.id,
          teacherId: request.teacherId,
          studentName: request.student.name,
          studentEmail: request.student.email,
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
        });
      }
    } else if (request.type === "book") {
      const lesson = await prisma.lesson.create({
        data: {
          teacherId: request.teacherId,
          studentId: request.studentId,
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
          status: "scheduled",
          prepStatus: "none",
          transcriptStatus: "waiting_drive",
        },
      });
      await attachMeetToLesson({
        lessonId: lesson.id,
        teacherId: request.teacherId,
        studentName: request.student.name,
        studentEmail: request.student.email,
        startsAt: request.requestedStart,
        endsAt: request.requestedEnd,
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

export async function cancelBookingRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const student = await getDemoStudent();
  const booking = await prisma.bookingRequest.findUniqueOrThrow({ where: { id } });
  if (booking.studentId !== student.id) throw new Error("Not your booking");
  if (booking.status !== "pending") throw new Error("Only pending requests can be cancelled");

  await prisma.bookingRequest.update({ where: { id }, data: { status: "cancelled" } });
  revalidatePath("/student/book");
  revalidatePath("/availability");
  revalidatePath("/calendar");
}

export async function createStudent(formData: FormData) {
  const teacher = await getTeacher();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const level = String(formData.get("level") ?? "N4");
  const goals = String(formData.get("goals") ?? "");
  const recordingConsent = formData.get("recordingConsent") === "on";

  if (!name || !email) throw new Error("Name and email are required");

  const token = createInviteToken();
  const student = await prisma.student.create({
    data: {
      teacherId: teacher.id,
      name,
      email,
      level,
      goals,
      recordingConsent,
      inviteToken: token,
      inviteTokenExpiresAt: inviteExpiry(14),
    },
  });

  revalidatePath("/students");
  redirect(`/students/${student.id}`);
}

export async function updateStudent(formData: FormData) {
  const studentId = String(formData.get("studentId") ?? "");
  await prisma.student.update({
    where: { id: studentId },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      goals: String(formData.get("goals") ?? ""),
      privateNotes: String(formData.get("privateNotes") ?? ""),
      level: String(formData.get("level") ?? "N4"),
      recordingConsent: formData.get("recordingConsent") === "on",
    },
  });
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/students");
}

/** @deprecated use updateStudent */
export async function updateStudentNotes(formData: FormData) {
  return updateStudent(formData);
}

export async function archiveStudent(formData: FormData) {
  const studentId = String(formData.get("studentId") ?? "");
  await prisma.student.update({
    where: { id: studentId },
    data: { archivedAt: new Date(), inviteToken: null, inviteTokenExpiresAt: null },
  });
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  redirect("/students");
}

export async function restoreStudent(formData: FormData) {
  const studentId = String(formData.get("studentId") ?? "");
  await prisma.student.update({
    where: { id: studentId },
    data: { archivedAt: null },
  });
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
}

export async function regenerateInviteToken(formData: FormData) {
  const studentId = String(formData.get("studentId") ?? "");
  await prisma.student.update({
    where: { id: studentId },
    data: {
      inviteToken: createInviteToken(),
      inviteTokenExpiresAt: inviteExpiry(14),
    },
  });
  revalidatePath(`/students/${studentId}`);
}

export async function disconnectGoogle() {
  const teacher = await getTeacher();
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: {
      googleRefreshToken: null,
      googleAccessToken: null,
      googleTokenExpiry: null,
      googleConnectedEmail: null,
    },
  });
  revalidatePath("/settings");
  revalidatePath("/calendar");
}
