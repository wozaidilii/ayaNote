import { addDays, addMinutes } from "date-fns";
import { prisma } from "@/lib/db";
import {
  getValidAccessToken,
  listCalendarEvents,
  type GoogleCalendarEvent,
} from "@/lib/google";
import { toJson } from "@/lib/utils";

const PLACEHOLDER_DOMAIN = "calendar.ayanote.local";

function isRealCalendarEventId(id: string | null | undefined) {
  if (!id) return false;
  return !id.startsWith("demo-") && !id.startsWith("fallback-");
}

function extractMeetLink(event: GoogleCalendarEvent) {
  const fromEntry = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  return event.hangoutLink || fromEntry || null;
}

function eventTimes(event: GoogleCalendarEvent): { start: Date; end: Date } | null {
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

function looksLikeLesson(event: GoogleCalendarEvent) {
  const summary = event.summary ?? "";
  const meet = extractMeetLink(event);
  if (meet) return true;
  return /レッスン|lesson|japanese|日本語|授業|ayanote/i.test(summary);
}

function studentDisplayName(event: GoogleCalendarEvent) {
  const guests = guestAttendees(event);
  const fromBracket = nameFromBracketTitle(event.summary);
  const fromGuest =
    guests[0]?.displayName?.trim() ||
    (guests[0]?.email ? emailLocalName(guests[0].email) : null);
  return (fromBracket || fromGuest || "Calendar guest").slice(0, 80);
}

async function resolveStudentForEvent(teacherId: string, event: GoogleCalendarEvent) {
  const guests = guestAttendees(event);
  const displayName = studentDisplayName(event);

  for (const guest of guests) {
    const email = guest.email!.toLowerCase();
    const existing = await prisma.student.findFirst({
      where: { teacherId, email },
    });
    if (existing) {
      const shouldRename =
        !existing.name ||
        existing.name === "Calendar guest" ||
        /japanese lesson/i.test(existing.name) ||
        existing.name.startsWith("[") ||
        existing.name.includes("二次面接");
      return prisma.student.update({
        where: { id: existing.id },
        data: {
          archivedAt: null,
          ...(shouldRename ? { name: displayName } : {}),
        },
      });
    }
  }

  const email =
    guests[0]?.email?.toLowerCase() ||
    `cal-${event.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24).toLowerCase()}@${PLACEHOLDER_DOMAIN}`;

  const byName = await prisma.student.findFirst({
    where: {
      teacherId,
      archivedAt: null,
      name: { equals: displayName, mode: "insensitive" },
    },
  });
  if (byName && !guests[0]?.email) return byName;

  return prisma.student.upsert({
    where: { teacherId_email: { teacherId, email } },
    create: {
      teacherId,
      name: displayName,
      email,
      level: "—",
      courseType: "custom",
      goals: "Imported from Google Calendar",
      privateNotes: "Auto-created from a Calendar event. Edit profile as needed.",
      recordingConsent: false,
    },
    update: {
      name: displayName,
      archivedAt: null,
    },
  });
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
      OR: [{ lessonId: { in: ids } }, { note: { contains: "Work meeting conflict" } }],
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

export async function syncTeacherCalendar(teacherId: string): Promise<CalendarSyncResult> {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
  const purged = await purgeDummyLessons(teacherId);

  const accessToken = await getValidAccessToken(teacher);
  if (!accessToken) {
    return {
      ok: false,
      reason: "not_connected",
      imported: 0,
      updated: 0,
      cancelled: 0,
      purged,
      scanned: 0,
      skipped: 0,
    };
  }

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

  const timeMin = addDays(new Date(), -30);
  const timeMax = addDays(new Date(), 60);
  const events = await listCalendarEvents({ accessToken, timeMin, timeMax, maxResults: 150 });

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
    const student = await resolveStudentForEvent(teacherId, event);
    const isCancelled = event.status === "cancelled";
    const status = isCancelled
      ? "cancelled"
      : times.end.getTime() < Date.now()
        ? "completed"
        : "scheduled";

    const existing = await prisma.lesson.findFirst({
      where: { calendarEventId: event.id },
      include: { summary: true, transcript: true },
    });

    if (existing) {
      await prisma.lesson.update({
        where: { id: existing.id },
        data: {
          studentId: student.id,
          startsAt: times.start,
          endsAt: times.end,
          status: existing.summary || existing.transcript ? existing.status : status,
          meetLink: meetLink ?? existing.meetLink,
          tagsJson: toJson(["google_calendar"]),
        },
      });
      updated += 1;
      if (isCancelled) cancelled += 1;
      continue;
    }

    const nearDup = await prisma.lesson.findFirst({
      where: {
        teacherId,
        studentId: student.id,
        startsAt: times.start,
        status: { not: "cancelled" },
      },
      include: { summary: true, transcript: true },
    });
    if (nearDup) {
      await prisma.lesson.update({
        where: { id: nearDup.id },
        data: {
          calendarEventId: event.id,
          endsAt: times.end,
          meetLink: meetLink ?? nearDup.meetLink,
          tagsJson: toJson(["google_calendar"]),
          status: nearDup.summary || nearDup.transcript ? nearDup.status : status,
        },
      });
      updated += 1;
      continue;
    }

    await prisma.lesson.create({
      data: {
        teacherId,
        studentId: student.id,
        startsAt: times.start,
        endsAt: times.end.getTime() === times.start.getTime() ? addMinutes(times.start, 60) : times.end,
        status,
        prepStatus: "none",
        calendarEventId: event.id,
        meetLink,
        transcriptStatus: status === "scheduled" ? "waiting_drive" : "none",
        tagsJson: toJson(["google_calendar"]),
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

  // Drop non-lesson imports left from earlier syncs (no Meet + no lesson keywords in linked student noise)
  // Keep all google_calendar lessons that remain in seenIds / past with meet.

  return {
    ok: true,
    imported,
    updated,
    cancelled,
    purged,
    scanned: events.length,
    skipped,
  };
}
