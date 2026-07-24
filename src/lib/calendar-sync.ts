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
  // Skip all-day events (date-only).
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

function guestAttendees(event: GoogleCalendarEvent) {
  return (event.attendees ?? []).filter((a) => a.email && !a.self && !a.organizer);
}

function titleToStudentName(summary?: string) {
  if (!summary?.trim()) return "Calendar guest";
  const cleaned = summary
    .replace(/^AyaNote\s*[·•\-–—]\s*/i, "")
    .replace(/^(Lesson|レッスン|授業|Class)\s*(with|：|:)?\s*/i, "")
    .trim();
  return cleaned.slice(0, 80) || "Calendar guest";
}

async function resolveStudentForEvent(teacherId: string, event: GoogleCalendarEvent) {
  const guests = guestAttendees(event);

  for (const guest of guests) {
    const email = guest.email!.toLowerCase();
    const existing = await prisma.student.findFirst({
      where: { teacherId, email, archivedAt: null },
    });
    if (existing) return existing;
  }

  const nameHint = guests[0]?.displayName || titleToStudentName(event.summary);
  const byName = await prisma.student.findFirst({
    where: {
      teacherId,
      archivedAt: null,
      name: { equals: nameHint, mode: "insensitive" },
    },
  });
  if (byName) return byName;

  const email =
    guests[0]?.email?.toLowerCase() ||
    `cal-${event.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24).toLowerCase()}@${PLACEHOLDER_DOMAIN}`;

  return prisma.student.upsert({
    where: { teacherId_email: { teacherId, email } },
    create: {
      teacherId,
      name: nameHint,
      email,
      level: "—",
      goals: "Imported from Google Calendar",
      privateNotes: "Auto-created from a Calendar event. Edit profile as needed.",
      recordingConsent: false,
    },
    update: {
      name: nameHint,
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
};

export async function syncTeacherCalendar(teacherId: string): Promise<CalendarSyncResult> {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } });
  const purged = await purgeDummyLessons(teacherId);

  const accessToken = await getValidAccessToken(teacher);
  if (!accessToken) {
    return { ok: false, reason: "not_connected", imported: 0, updated: 0, cancelled: 0, purged, scanned: 0 };
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
  const seenIds = new Set<string>();

  for (const event of events) {
    if (!event.id) continue;
    const times = eventTimes(event);
    if (!times) continue; // all-day or invalid

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

    // Avoid duplicate if we already have a lesson at same slot for same student without event id
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
        endsAt: times.end.getTime() === times.start.getTime()
          ? addMinutes(times.start, 60)
          : times.end,
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

  // Mark previously synced lessons cancelled if they disappeared from the window as cancelled-only
  // (Google omits cancelled unless showDeleted — we only mark missing future synced ones softly)
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
    // Keep lessons created by AyaNote booking that may not be in list yet; only cancel if tagged google_calendar
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
    purged,
    scanned: events.length,
  };
}
