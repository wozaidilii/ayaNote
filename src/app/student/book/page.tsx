import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { CalendarPlus } from "@/components/icons";
import {
  StudentBookCalendar,
  type StudentCalBlock,
} from "@/components/student-book-calendar";
import { PageHeading } from "@/components/ui-heading";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { generateAvailableSlots } from "@/lib/scheduling";
import {
  consecutiveYmds,
  dayBoundsInTz,
  normalizeTimezone,
  shiftYmd,
  startOfWeekMondayYmd,
  ymdInTz,
} from "@/lib/timezone";

export default async function StudentBookPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const sp = await searchParams;
  const active = await getActiveStudent();
  const [t, teacher, student] = await Promise.all([
    getTranslations("studentBook"),
    prisma.teacher.findUniqueOrThrow({
      where: { id: active.teacherId },
      include: {
        availabilityRules: true,
        blackoutDates: true,
      },
    }),
    prisma.student.findFirstOrThrow({
      where: { id: active.id },
      include: {
        bookingRequests: { orderBy: { createdAt: "desc" }, take: 12 },
        lessons: {
          where: { status: { not: "cancelled" } },
          orderBy: { startsAt: "asc" },
        },
      },
    }),
  ]);

  const timeZone = normalizeTimezone(
    teacher.timezone || teacher.availabilityRules?.timezone || "Asia/Tokyo",
  );
  const todayYmd = ymdInTz(new Date(), timeZone);
  const anchorYmd =
    sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : todayYmd;
  const daysStart = startOfWeekMondayYmd(anchorYmd, timeZone);
  const weekDays = consecutiveYmds(daysStart, 7, timeZone);
  const prevStart = shiftYmd(daysStart, -7, timeZone);
  const nextStart = shiftYmd(daysStart, 7, timeZone);
  const thisWeekStart = startOfWeekMondayYmd(todayYmd, timeZone);

  const rangeStart = dayBoundsInTz(weekDays[0]!, timeZone).start;
  const rangeEnd = dayBoundsInTz(
    shiftYmd(weekDays[weekDays.length - 1]!, 1, timeZone),
    timeZone,
  ).start;

  const rules = {
    weekdaysJson: teacher.availabilityRules?.weekdaysJson ?? "[1,2,3,4,5,6]",
    startTime: teacher.availabilityRules?.startTime ?? "10:00",
    endTime: teacher.availabilityRules?.endTime ?? "20:00",
    minNoticeHours: teacher.availabilityRules?.minNoticeHours ?? 24,
    slotMinutes: 60,
    maxWeeklyLessons:
      student.lessonsPerWeek ??
      teacher.availabilityRules?.maxWeeklyLessons ??
      6,
    timezone: timeZone,
  };

  const [busyLessons, pendingAll] = await Promise.all([
    prisma.lesson.findMany({
      where: {
        teacherId: teacher.id,
        status: { not: "cancelled" },
        startsAt: { gte: rangeStart, lt: rangeEnd },
      },
      select: {
        id: true,
        studentId: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    }),
    prisma.bookingRequest.findMany({
      where: { teacherId: teacher.id, status: "pending" },
      select: {
        id: true,
        studentId: true,
        requestedStart: true,
        requestedEnd: true,
      },
    }),
  ]);

  const busy = [
    ...busyLessons.map((l) => ({ start: l.startsAt, end: l.endsAt })),
    ...pendingAll.map((b) => ({
      start: b.requestedStart,
      end: b.requestedEnd,
    })),
  ];

  const openSlots = generateAvailableSlots({
    rules,
    busy,
    blackoutDates: teacher.blackoutDates.map((b) => b.date),
    studentLessonStarts: student.lessons
      .filter((l) => l.status !== "cancelled")
      .map((l) => l.startsAt),
    from: rangeStart,
    days: 8,
  }).filter((d) => d >= rangeStart && d < rangeEnd);

  const blocks: StudentCalBlock[] = [];
  for (const lesson of busyLessons) {
    const mine = lesson.studentId === student.id;
    blocks.push({
      id: lesson.id,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      kind: mine ? "mine" : "busy",
      label: mine ? t("yourLesson") : t("busy"),
    });
  }
  for (const req of pendingAll) {
    const mine = req.studentId === student.id;
    blocks.push({
      id: req.id,
      startsAt: req.requestedStart.toISOString(),
      endsAt: req.requestedEnd.toISOString(),
      kind: mine ? "pending" : "busy",
      label: mine ? t("yourPending") : t("busy"),
    });
  }

  const studentUpcoming = student.lessons.filter(
    (l) => l.status === "scheduled" && l.startsAt >= new Date(),
  );

  return (
    <AppShell active="book" personName={student.name}>
      <PageHeading
        icon={CalendarPlus}
        title={t("title")}
        subtitle={
          <>
            {t("subtitle")} · {student.name}
          </>
        }
      />

      <div className="panel">
        <span className="pixel-banner">{t("slotRule")}</span>
        <p style={{ marginBottom: 0, marginTop: "0.7rem" }}>{t("slotHint")}</p>
      </div>

      <div className="panel">
        <StudentBookCalendar
          days={weekDays}
          blocks={blocks}
          openSlotIsos={openSlots.map((s) => s.toISOString())}
          timeZone={timeZone}
          todayYmd={todayYmd}
          weekStartYmd={thisWeekStart}
          prevStart={prevStart}
          nextStart={nextStart}
          nextLessonId={studentUpcoming[0]?.id}
          bookings={student.bookingRequests.map((b) => ({
            id: b.id,
            type: b.type,
            status: b.status,
            note: b.note,
            requestedStart: b.requestedStart.toISOString(),
          }))}
          labels={{
            timezone: t("timezone"),
            today: t("todayBtn"),
            busy: t("busy"),
            yourLesson: t("yourLesson"),
            yourPending: t("yourPending"),
            requestTitle: t("requestTitle"),
            requestHint: t("requestHint"),
            request: t("request"),
            note: t("note"),
            typeBook: t("typeBook"),
            typeReschedule: t("typeReschedule"),
            confirm: t("confirm"),
            cancel: t("cancel"),
            close: t("close"),
            duration: t("duration"),
            myBookings: t("myBookings"),
            slotTaken: t("slotTaken"),
          }}
        />
      </div>
    </AppShell>
  );
}
