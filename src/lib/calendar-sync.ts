import { addDays, addMinutes } from "date-fns";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getValidAccessToken,
  listCalendarEvents,
  type GoogleCalendarEvent,
} from "@/lib/google";
import type { BusyInterval } from "@/lib/scheduling";
import { parseJsonArray, toJson } from "@/lib/utils";

export const UNASSIGNED_CALENDAR_EMAIL = "unassigned@calendar.ayanote.local";
const PLACEHOLDER_DOMAIN = "calendar.ayanote.local";

export function isCalendarInboxEmail(email: string | null | undefined) {
  return (email ?? "").toLowerCase() === UNASSIGNED_CALENDAR_EMAIL;
}

export function isCalendarPlaceholderEmail(email: string | null | undefined) {
  const value = (email ?? "").toLowerCase();
  return value.endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

export function isUnassignedLessonTags(tagsJson: string | null | undefined) {
  return parseJsonArray(tagsJson).includes("unassigned");
}

function isRealCalendarEventId(id: string | null | undefined) {
  if (!id) return false;
  return !id.startsWith("demo-") && !id.startsWith("fallback-");
}

function extractMeetLink(event: GoogleCalendarEvent) {
  const fromEntry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  )?.uri;
  return event.hangoutLink || fromEntry || null;
}

export function eventTimes(
  event: GoogleCalendarEvent,
): { start: Date; end: Date } | null {
  const startRaw = event.start?.dateTime;
  const endRaw = event.end?.dateTime;
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

function guestAttendees(event: GoogleCalendarEvent) {
  return (event.attendees ?? []).filter((a) => a.email && !a.self);
}

/** Titles like "[kaiさん] Japanese lesson" → "kaiさん" */
function nameFromBracketTitle(summary?: string) {
  if (!summary) return null;
  const m = summary.match(/^\[([^\]]+)\]/);
  return m?.[1]?.trim() || null;
}

function emailLocalName(email: string) {
  const local = email.split("@")[0] ?? email;
  return local.replace(/[._]+/g, " ").trim() || email;
}

export function looksLikeLesson(event: GoogleCalendarEvent) {
  const text = `${event.summary ?? ""} ${event.description ?? ""}`;
  const meet = extractMeetLink(event);
  if (meet) return true;
  return /レッスン|lesson|japanese|日本語|授業|ayanote/i.test(text);
}

function isOpaqueBusy(event: GoogleCalendarEvent) {
  if (event.status === "cancelled") return false;
  return (event.transparency ?? "opaque") !== "transparent";
}

function studentDisplayName(event: GoogleCalendarEvent) {
  const guests = guestAttendees(event);
  const fromBracket = nameFromBracketTitle(event.summary);
  const fromGuest =
    guests[0]?.displayName?.trim() ||
    (guests[0]?.email ? emailLocalName(guests[0].email) : null);
  return (fromBracket || fromGuest || "未指定").slice(0, 80);
}

function calendarTags(unassigned: boolean, existingJson?: string | null) {
  const tags = parseJsonArray(existingJson).filter(
    (t) => t !== "unassigned" && t !== "google_calendar",
  );
  tags.push("google_calendar");
  if (unassigned) tags.push("unassigned");
  return toJson(tags);
}

export async function persistGoogleAccessToken(
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

export async function ensureUnassignedInboxStudent(teacherId: string) {
  const existing = await prisma.student.findUnique({
    where: {
      teacherId_email: { teacherId, email: UNASSIGNED_CALENDAR_EMAIL },
    },
  });
  if (existing) {
    if (existing.archivedAt) {
      return prisma.student.update({
        where: { id: existing.id },
        data: { archivedAt: null },
      });
    }
    return existing;
  }

  const passwordHash = await hashPassword(
    `inbox-${teacherId}-${crypto.randomUUID()}`,
  );
  return prisma.student.create({
    data: {
      teacherId,
      name: "未指定",
      email: UNASSIGNED_CALENDAR_EMAIL,
      passwordHash,
      level: "—",
      courseType: "custom",
      goals: "Google Calendar unmatched lessons",
      privateNotes:
        "Inbox for calendar events with no student yet. Do not use as a real student.",
      recordingConsent: false,
    },
  });
}

async function matchRealStudent(teacherId: string, event: GoogleCalendarEvent) {
  const guests = guestAttendees(event);
  const displayName = studentDisplayName(event);

  for (const guest of guests) {
    const email = guest.email!.toLowerCase();
    if (isCalendarPlaceholderEmail(email)) continue;
    const existing = await prisma.student.findFirst({
      where: { teacherId, email },
    });
    if (existing && !isCalendarPlaceholderEmail(existing.email)) {
      return existing;
    }
  }

  if (
    displayName &&
    displayName !== "未指定" &&
    displayName !== "Calendar guest"
  ) {
    const byName = await prisma.student.findFirst({
      where: {
        teacherId,
        archivedAt: null,
        name: { equals: displayName, mode: "insensitive" },
        NOT: {
          email: { endsWith: `@${PLACEHOLDER_DOMAIN}` },
        },
      },
    });
    if (byName) return byName;
  }

  return null;
}

function isRealBoundStudent(email: string) {
  return !isCalendarPlaceholderEmail(email);
}

/** Remove seed / demo lessons that are not real Google Calendar events. */
export async function purgeDummyLessons(teacherId: string) {
  const dummy = await prisma.lesson.findMany({
    where: {
      teacherId,
      OR: [
        { calendarEventId: null },
        { calendarEventId: { startsWith: "demo-" } },
        { calendarEventId: { startsWith: "fallback-" } },
        { meetLink: { contains: "aya-note" } },
        { meetLink: { contains: "ayanote-" } },
      ],
    },
    select: { id: true },
  });
  const ids = dummy.map((d) => d.id);
  if (ids.length === 0) return 0;

  await prisma.bookingRequest.deleteMany({
    where: {
      teacherId,
      OR: [
        { lessonId: { in: ids } },
        { note: { contains: "Work meeting conflict" } },
      ],
    },
  });
  await prisma.prepDraft.deleteMany({ where: { lessonId: { in: ids } } });
  await prisma.summary.deleteMany({ where: { lessonId: { in: ids } } });
  await prisma.transcript.deleteMany({ where: { lessonId: { in: ids } } });
  await prisma.lesson.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

export type CalendarSyncResult = {
  ok: boolean;
  reason?: string;
  imported: number;
  updated: number;
  cancelled: number;
  purged: number;
  scanned: number;
  skipped: number;
};

export async function listGoogleBusyIntervals(
  teacher: {
    id: string;
    googleAccessToken: string | null;
    googleRefreshToken: string | null;
    googleTokenExpiry: Date | null;
  },
  timeMin: Date,
  timeMax: Date,
): Promise<BusyInterval[]> {
  const accessToken = await getValidAccessToken(teacher);
  if (!accessToken) return [];
  await persistGoogleAccessToken(teacher.id, teacher, accessToken);

  const events = await listCalendarEvents({
    accessToken,
    timeMin,
    timeMax,
    maxResults: 250,
  });

  const busy: BusyInterval[] = [];
  for (const event of events) {
    const times = eventTimes(event);
    if (!times) continue;
    if (!isOpaqueBusy(event)) continue;
    busy.push({ start: times.start, end: times.end });
  }
  return busy;
}

export async function syncTeacherCalendar(
  teacherId: string,
): Promise<CalendarSyncResult> {
  const teacher = await prisma.teacher.findUniqueOrThrow({
    where: { id: teacherId },
  });

  const accessToken = await getValidAccessToken(teacher);
  if (!accessToken) {
    return {
      ok: false,
      reason: "not_connected",
      imported: 0,
      updated: 0,
      cancelled: 0,
      purged: 0,
      scanned: 0,
      skipped: 0,
    };
  }

  await persistGoogleAccessToken(teacherId, teacher, accessToken);

  const timeMin = addDays(new Date(), -30);
  const timeMax = addDays(new Date(), 60);
  const events = await listCalendarEvents({
    accessToken,
    timeMin,
    timeMax,
    maxResults: 150,
  });

  const inbox = await ensureUnassignedInboxStudent(teacherId);

  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;
  const seenIds = new Set<string>();

  for (const event of events) {
    if (!event.id) continue;
    const times = eventTimes(event);
    if (!times) {
      skipped += 1;
      continue;
    }
    if (!looksLikeLesson(event)) {
      skipped += 1;
      continue;
    }

    seenIds.add(event.id);
    const meetLink = extractMeetLink(event);
    const matched = await matchRealStudent(teacherId, event);
    const isCancelled = event.status === "cancelled";
    const status = isCancelled
      ? "cancelled"
      : times.end.getTime() < Date.now()
        ? "completed"
        : "scheduled";

    const existing = await prisma.lesson.findFirst({
      where: { calendarEventId: event.id },
      include: { summary: true, transcript: true, student: true },
    });

    const keepBoundStudent =
      existing && isRealBoundStudent(existing.student.email);
    const studentId = keepBoundStudent
      ? existing.studentId
      : (matched?.id ?? inbox.id);
    const unassigned = studentId === inbox.id;

    if (existing) {
      await prisma.lesson.update({
        where: { id: existing.id },
        data: {
          studentId,
          startsAt: times.start,
          endsAt: times.end,
          status:
            existing.summary || existing.transcript ? existing.status : status,
          meetLink: meetLink ?? existing.meetLink,
          tagsJson: calendarTags(unassigned, existing.tagsJson),
        },
      });
      updated += 1;
      if (isCancelled) cancelled += 1;
      continue;
    }

    const nearDup = matched
      ? await prisma.lesson.findFirst({
          where: {
            teacherId,
            studentId: matched.id,
            startsAt: times.start,
            status: { not: "cancelled" },
          },
          include: { summary: true, transcript: true },
        })
      : null;
    if (nearDup) {
      await prisma.lesson.update({
        where: { id: nearDup.id },
        data: {
          calendarEventId: event.id,
          endsAt: times.end,
          meetLink: meetLink ?? nearDup.meetLink,
          tagsJson: calendarTags(false, nearDup.tagsJson),
          status:
            nearDup.summary || nearDup.transcript ? nearDup.status : status,
        },
      });
      updated += 1;
      continue;
    }

    await prisma.lesson.create({
      data: {
        teacherId,
        studentId,
        startsAt: times.start,
        endsAt:
          times.end.getTime() === times.start.getTime()
            ? addMinutes(times.start, 60)
            : times.end,
        status,
        prepStatus: "none",
        calendarEventId: event.id,
        meetLink,
        transcriptStatus: status === "scheduled" ? "waiting_drive" : "none",
        tagsJson: calendarTags(unassigned),
      },
    });
    imported += 1;
  }

  const futureSynced = await prisma.lesson.findMany({
    where: {
      teacherId,
      status: "scheduled",
      startsAt: { gte: new Date() },
      calendarEventId: { not: null },
    },
  });
  for (const lesson of futureSynced) {
    if (!isRealCalendarEventId(lesson.calendarEventId)) continue;
    if (seenIds.has(lesson.calendarEventId!)) continue;
    if (!lesson.tagsJson.includes("google_calendar")) continue;
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { status: "cancelled" },
    });
    cancelled += 1;
  }

  return {
    ok: true,
    imported,
    updated,
    cancelled,
    purged: 0,
    scanned: events.length,
    skipped,
  };
}
