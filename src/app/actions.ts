"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addMinutes } from "date-fns";
import { courseTypeLabel, generatePrepDraft, getAiProvider } from "@/lib/ai";
import { checkBookingConflict, isHalfHourAlignedMinute } from "@/lib/booking";
import { applyTranscriptToLesson, fetchAndImportDriveTranscript, seedMemoryFromDriveForTeacher } from "@/lib/drive-transcript";
import { prisma } from "@/lib/db";
import {
  createCalendarMeetEvent,
  getValidAccessToken,
  updateCalendarEvent,
} from "@/lib/google";
import { syncTeacherCalendar } from "@/lib/calendar-sync";
import { createInviteToken, inviteExpiry } from "@/lib/invite";
import type { PrepRefs } from "@/lib/prep-refs";
import { parsePrepRefs, withEditedGeneration } from "@/lib/prep-refs";
import { LESSON_MINUTES, blackoutDateFromYmd } from "@/lib/scheduling";
import { DEMO_TEACHER_EMAIL, type AppRole } from "@/lib/session";
import { getActiveStudent } from "@/lib/active-student";
import {
  deriveStrengths,
  mergeStringLists,
  planGrammarMerge,
  planVocabMerge,
} from "@/lib/student-memory";
import { formatInTz, normalizeTimezone, parseIsoOrLocal } from "@/lib/timezone";
import { parseJsonArray, toJson } from "@/lib/utils";

export async function setRole(role: AppRole) {
  const jar = await cookies();
  jar.set("ayanote_role", role, { path: "/" });
  redirect(role === "teacher" ? "/today" : "/student");
}

export async function setActiveStudent(formData: FormData) {
  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) throw new Error("Student required");
  const student = await prisma.student.findFirst({
    where: { id: studentId, archivedAt: null },
  });
  if (!student) throw new Error("Student not found");
  const jar = await cookies();
  jar.set("ayanote_student_id", student.id, { path: "/" });
  revalidatePath("/student");
  revalidatePath("/student/book");
  revalidatePath("/student/history");
  redirect("/student");
}

/** Bind invite token to student portal session (lite login until full auth). */
export async function acceptInvite(token: string) {
  const student = await prisma.student.findUnique({
    where: { inviteToken: token },
  });
  if (!student || student.archivedAt) {
    redirect("/?err=invite_invalid");
  }
  if (student.inviteTokenExpiresAt && student.inviteTokenExpiresAt < new Date()) {
    redirect(`/invite/${token}?err=expired`);
  }
  const jar = await cookies();
  jar.set("ayanote_role", "student", { path: "/" });
  jar.set("ayanote_student_id", student.id, { path: "/" });
  revalidatePath("/student");
  redirect("/student");
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
  return getActiveStudent();
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
  timeZone?: string;
}) {
  const accessToken = await teacherAccessToken(opts.teacherId);
  const meet = await createCalendarMeetEvent({
    accessToken,
    summary: `AyaNote · ${opts.studentName}`,
    description: "Japanese lesson via AyaNote",
    start: opts.startsAt,
    end: opts.endsAt,
    timeZone: opts.timeZone,
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

  if (!lessonId) {
    redirect("/today?err=missing_lesson");
  }
  if (!rawText.trim()) {
    redirect(`/lessons/${lessonId}?err=empty_transcript`);
  }

  await applyTranscriptToLesson({
    lessonId,
    rawText,
    source: "meet_import",
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

export async function fetchDriveTranscriptForLesson(formData: FormData) {
  const lessonId = String(formData.get("lessonId") ?? "");
  if (!lessonId) redirect("/today?err=missing_lesson");

  const result = await fetchAndImportDriveTranscript(lessonId);
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/students");
  revalidatePath("/today");

  if (result.status === "imported") {
    redirect(`/lessons/${lessonId}?ok=drive&file=${encodeURIComponent(result.fileName ?? "")}`);
  }
  redirect(`/lessons/${lessonId}?err=drive_${result.status}`);
}

export async function saveTranscriptFolderId(formData: FormData) {
  const teacher = await getTeacher();
  const folderId = String(formData.get("googleTranscriptFolderId") ?? "").trim() || null;
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { googleTranscriptFolderId: folderId },
  });
  revalidatePath("/settings");
  redirect("/settings?google=folder_saved");
}

export async function approveSummary(formData: FormData) {
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

  const alreadyCounted = lesson.status === "completed";
  await prisma.progressSnapshot.upsert({
    where: { studentId: lesson.studentId },
    create: {
      studentId: lesson.studentId,
      topicsCoveredJson: toJson(covered),
      strengthsJson: toJson(strengths),
      weaknessesJson: toJson(weaknesses),
      attendanceCount: 1,
      note: nextFocus,
    },
    update: {
      topicsCoveredJson: toJson(covered),
      strengthsJson: toJson(strengths),
      weaknessesJson: toJson(weaknesses),
      attendanceCount: alreadyCounted
        ? (existing?.attendanceCount ?? 1)
        : (existing?.attendanceCount ?? 0) + 1,
      note: nextFocus,
    },
  });

  if (lesson.status !== "completed") {
    await prisma.lesson.update({
      where: { id: lessonId },
      data: { status: "completed" },
    });
  }

  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath(`/students/${lesson.studentId}`);
  revalidatePath("/student");
  revalidatePath("/student/history");
  revalidatePath("/today");
  redirect(`/lessons/${lessonId}?ok=approved`);
}

export async function updateLessonStatus(formData: FormData) {
  const lessonId = String(formData.get("lessonId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["scheduled", "in_progress", "completed", "cancelled"].includes(status)) {
    redirect(`/lessons/${lessonId}?err=bad_status`);
  }
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { status },
  });
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/today");
  revalidatePath("/calendar");
  redirect(`/lessons/${lessonId}?ok=status`);
}

async function writePrepDraftForLesson(lessonId: string) {
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
  const vocab = lesson.student.vocabItems.map((v) => v.term);
  const pastLessonLinks = lesson.student.lessons.map((l) => {
    const focus = l.summary?.nextFocus?.trim();
    const topics = l.summary ? parseJsonArray(l.summary.topicsJson).slice(0, 2) : [];
    const label = focus || topics.join(" / ") || "past lesson";
    return { id: l.id, label };
  });
  const pastLessons = pastLessonLinks.map((l) => l.label);

  const generated = await generatePrepDraft({
    studentName: lesson.student.name,
    level: lesson.student.level,
    courseType: lesson.student.courseType,
    goals: lesson.student.goals,
    lastTopics,
    weaknesses,
    vocab,
  });
  const { generationSource, ...draft } = generated;

  const refs: PrepRefs = {
    course: courseTypeLabel(lesson.student.courseType),
    level: lesson.student.level,
    goals: lesson.student.goals?.trim() || "",
    pastLessons,
    pastLessonLinks,
    topics: [...new Set(lastTopics)].slice(0, 8),
    weaknesses: weaknesses.slice(0, 6),
    vocab: vocab.slice(0, 10),
    generationSource,
  };

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: { lessonId, ...draft, refsJson: toJson(refs), status: "draft" },
    update: { ...draft, refsJson: toJson(refs), status: "draft" },
  });

  await prisma.lesson.update({
    where: { id: lessonId },
    data: { prepStatus: "draft" },
  });

  return { lessonId, draft, refs };
}

function revalidatePrepSurfaces(lessonIds: string[] = []) {
  revalidatePath("/prep");
  revalidatePath("/today");
  revalidatePath("/calendar");
  for (const id of lessonIds) {
    revalidatePath(`/lessons/${id}`);
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
    return { generated: [] as Awaited<ReturnType<typeof writePrepDraftForLesson>>[], skipped: 0 };
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

  const existing = await prisma.prepDraft.findUnique({ where: { lessonId } });
  const refs = withEditedGeneration(parsePrepRefs(existing?.refsJson));

  await prisma.prepDraft.upsert({
    where: { lessonId },
    create: { lessonId, ...data, refsJson: toJson(refs) },
    update: { ...data, refsJson: toJson(refs) },
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
  const timezone = normalizeTimezone(String(formData.get("timezone") ?? "Asia/Tokyo"));
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
  redirect("/settings?google=timezone_saved");
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
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/availability");
  const request = await prisma.bookingRequest.findUniqueOrThrow({
    where: { id },
    include: { student: true },
  });

  if (decision === "approve") {
    const busy = await prisma.lesson.findMany({
      where: {
        teacherId: request.teacherId,
        status: { not: "cancelled" },
      },
      select: { id: true, startsAt: true, endsAt: true },
    });
    const conflict = checkBookingConflict({
      requestedStart: request.requestedStart,
      requestedEnd: request.requestedEnd,
      existing: busy,
      excludeLessonId: request.lessonId,
    });
    if (!conflict.ok) {
      redirect(`${returnTo}?err=booking_conflict`);
    }

    await prisma.bookingRequest.update({ where: { id }, data: { status: "approved" } });

    const teacherTz = await prisma.teacher.findUnique({
      where: { id: request.teacherId },
      select: { timezone: true },
    });
    const timeZone = normalizeTimezone(teacherTz?.timezone);

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
          timeZone,
        });
      } else {
        await attachMeetToLesson({
          lessonId: lesson.id,
          teacherId: request.teacherId,
          studentName: request.student.name,
          studentEmail: request.student.email,
          startsAt: request.requestedStart,
          endsAt: request.requestedEnd,
          timeZone,
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
        timeZone,
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
  redirect(`${returnTo}?ok=booking_${decision === "approve" ? "approved" : "declined"}`);
}

export async function createBookingRequest(formData: FormData) {
  const teacher = await getTeacher();
  const student = await getDemoStudent();
  const type = String(formData.get("type") ?? "book");
  const start = parseIsoOrLocal(String(formData.get("requestedStart") ?? ""));
  const note = String(formData.get("note") ?? "");
  if (Number.isNaN(start.getTime())) {
    redirect("/student/book?err=invalid_time");
  }

  const tz = normalizeTimezone(teacher.timezone);
  const minute = formatInTz(start, "mm", tz);
  if (!isHalfHourAlignedMinute(minute)) {
    redirect("/student/book?err=half_hour");
  }

  const end = addMinutes(start, LESSON_MINUTES);
  const excludeLessonId =
    type === "reschedule" ? String(formData.get("lessonId") || "") || null : null;
  const busy = await prisma.lesson.findMany({
    where: { teacherId: teacher.id, status: { not: "cancelled" } },
    select: { id: true, startsAt: true, endsAt: true },
  });
  const conflict = checkBookingConflict({
    requestedStart: start,
    requestedEnd: end,
    existing: busy,
    excludeLessonId,
  });
  if (!conflict.ok) {
    redirect("/student/book?err=booking_conflict");
  }

  await prisma.bookingRequest.create({
    data: {
      teacherId: teacher.id,
      studentId: student.id,
      type,
      requestedStart: start,
      requestedEnd: end,
      note,
      status: "pending",
      lessonId: excludeLessonId,
    },
  });

  revalidatePath("/student/book");
  revalidatePath("/availability");
  revalidatePath("/calendar");
  revalidatePath("/today");
  redirect("/student/book?ok=requested");
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
  const courseType = String(formData.get("courseType") ?? "jlpt_n4");
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
      courseType,
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
      courseType: String(formData.get("courseType") ?? "jlpt_n4"),
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

export async function syncGoogleCalendar() {
  const teacher = await getTeacher();
  await syncTeacherCalendar(teacher.id);
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/students");
  revalidatePath("/prep");
  revalidatePath("/student");
  redirect("/calendar?synced=1");
}

export async function seedMemoryFromDrive(formData: FormData) {
  const teacher = await getTeacher();
  const force = String(formData.get("force") ?? "") === "1";
  const result = await seedMemoryFromDriveForTeacher(teacher.id, { force, maxDocsPerStudent: 4 });

  revalidatePath("/students");
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/student");
  revalidatePath("/student/history");
  revalidatePath("/prep");

  const q = new URLSearchParams({
    seeded: "1",
    created: String(result.lessonsCreated),
    students: String(result.studentsProcessed),
    skipped: String(result.skippedStudents),
    scanned: String(result.docsScanned),
  });
  if (result.errors.length) q.set("seedErr", result.errors[0].slice(0, 120));
  redirect(`/students?${q.toString()}`);
}
