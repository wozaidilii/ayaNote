import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { decideBooking, syncGoogleCalendar } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { FiveDayCalendar } from "@/components/five-day-calendar";
import { MonthCalendar, type CalendarLessonItem } from "@/components/month-calendar";
import { syncTeacherCalendar } from "@/lib/calendar-sync";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import {
  consecutiveYmds,
  dayBoundsInTz,
  formatInTz,
  monthGridYm,
  normalizeTimezone,
  parseMonthParam,
  shiftMonth,
  shiftYmd,
  wallTimeToUtc,
  ymdInTz,
} from "@/lib/timezone";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    synced?: string;
    sync?: string;
    month?: string;
    day?: string;
    view?: string;
    start?: string;
  }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const view = sp.view === "month" ? "month" : "days";

  const [t, common, teacher] = await Promise.all([
    getTranslations("calendar"),
    getTranslations("common"),
    prisma.teacher.findUniqueOrThrow({
      where: { email: DEMO_TEACHER_EMAIL },
      include: { availabilityRules: true },
    }),
  ]);

  const timeZone = normalizeTimezone(
    teacher.timezone || teacher.availabilityRules?.timezone || "Asia/Tokyo",
  );
  const todayYmd = ymdInTz(now, timeZone);
  const month = parseMonthParam(sp.month, timeZone, now, teacher.locale || "ja");
  const weeks = monthGridYm(month.year, month.monthIndex0, timeZone);
  const prevMonth = shiftMonth(month.year, month.monthIndex0, -1);
  const nextMonth = shiftMonth(month.year, month.monthIndex0, 1);

  const daysStart =
    sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : todayYmd;
  const fiveDays = consecutiveYmds(daysStart, 5, timeZone);
  const prevStart = shiftYmd(daysStart, -5, timeZone);
  const nextStart = shiftYmd(daysStart, 5, timeZone);

  const googleConnected = Boolean(teacher.googleConnectedEmail || teacher.googleRefreshToken);

  let syncMeta: {
    imported: number;
    updated: number;
    purged: number;
    scanned: number;
    skipped: number;
  } | null = null;
  if (googleConnected && sp.sync === "1") {
    const result = await syncTeacherCalendar(teacher.id);
    if (result.ok) {
      syncMeta = {
        imported: result.imported,
        updated: result.updated,
        purged: result.purged,
        scanned: result.scanned,
        skipped: result.skipped,
      };
    }
  }

  const monthStartYmd = `${month.year}-${String(month.monthIndex0 + 1).padStart(2, "0")}-01`;
  const nextMonthKey = shiftMonth(month.year, month.monthIndex0, 1);
  const monthStartNoon = wallTimeToUtc(monthStartYmd, "12:00", timeZone);
  const monthEndNoon = wallTimeToUtc(`${nextMonthKey}-01`, "12:00", timeZone);
  const monthPaddedStart = dayBoundsInTz(
    ymdInTz(new Date(monthStartNoon.getTime() - 8 * 86400000), timeZone),
    timeZone,
  ).start;
  const monthPaddedEnd = dayBoundsInTz(
    ymdInTz(new Date(monthEndNoon.getTime() + 8 * 86400000), timeZone),
    timeZone,
  ).end;

  const daysRangeStart = dayBoundsInTz(fiveDays[0], timeZone).start;
  const daysRangeEnd = dayBoundsInTz(shiftYmd(fiveDays[fiveDays.length - 1], 1, timeZone), timeZone)
    .start;

  const rangeStart = view === "month" ? monthPaddedStart : daysRangeStart;
  const rangeEnd = view === "month" ? monthPaddedEnd : daysRangeEnd;

  const [lessons, pending] = await Promise.all([
    prisma.lesson.findMany({
      where: {
        teacherId: teacher.id,
        status: { not: "cancelled" },
        startsAt: { gte: rangeStart, lt: rangeEnd },
      },
      include: {
        student: true,
        summary: true,
        prepDraft: true,
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.bookingRequest.findMany({
      where: { teacherId: teacher.id, status: "pending" },
      include: { student: true },
      orderBy: { requestedStart: "asc" },
    }),
  ]);

  const calendarLessons: CalendarLessonItem[] = lessons.map((lesson) => ({
    id: lesson.id,
    startsAt: lesson.startsAt.toISOString(),
    endsAt: lesson.endsAt.toISOString(),
    studentName: lesson.student.name,
    status: lesson.status,
    meetLink: lesson.meetLink,
    prepStatus: lesson.prepStatus,
    hasSummary: Boolean(lesson.summary),
    fromGoogle: Boolean(lesson.calendarEventId && !lesson.calendarEventId.startsWith("demo-")),
  }));

  const locale = teacher.locale || "ja";

  return (
    <AppShell active="calendar">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="panel" style={{ marginTop: "1.1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", flexWrap: "wrap" }}>
          <div>
            <span className="pixel-banner">
              {googleConnected ? t("connected") : t("notConnected")}
            </span>
            <p style={{ margin: "0.7rem 0 0" }}>
              {googleConnected ? t("syncNoteConnected") : t("syncNote")}
            </p>
            {sp.synced === "1" && <p className="chip done">{t("justSynced")}</p>}
            {syncMeta && (
              <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                {t("syncStats", {
                  scanned: syncMeta.scanned,
                  imported: syncMeta.imported,
                  updated: syncMeta.updated,
                  purged: syncMeta.purged,
                })}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {!googleConnected ? (
              <a className="btn" href="/api/google/connect">
                {t("connectGoogle")}
              </a>
            ) : (
              <form action={syncGoogleCalendar}>
                <button className="btn" type="submit">
                  {t("syncNow")}
                </button>
              </form>
            )}
            <a className="btn sky" href="https://calendar.google.com/" target="_blank" rel="noreferrer">
              {t("openGoogle")}
            </a>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("pending")}</h2>
          {pending.map((b) => (
            <div className="list-row" key={b.id}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {b.student.name} · {b.type}
                </div>
                <div className="muted">
                  {formatInTz(b.requestedStart, "yyyy-MM-dd HH:mm", timeZone)} ({timeZone})
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <form action={decideBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="btn" type="submit">
                    {common("approve")}
                  </button>
                </form>
                <form action={decideBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="decision" value="decline" />
                  <button className="btn danger" type="submit">
                    {common("decline")}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="cal-view-tabs">
          <Link
            className={`btn ${view === "days" ? "" : "secondary"}`}
            href={`/calendar?view=days&start=${todayYmd}`}
          >
            {t("viewDays")}
          </Link>
          <Link
            className={`btn ${view === "month" ? "" : "secondary"}`}
            href={`/calendar?view=month&month=${todayYmd.slice(0, 7)}`}
          >
            {t("viewMonth")}
          </Link>
        </div>

        {view === "days" ? (
          <FiveDayCalendar
            days={fiveDays}
            lessons={calendarLessons}
            timeZone={timeZone}
            todayYmd={todayYmd}
            prevStart={prevStart}
            nextStart={nextStart}
            labels={{
              timezone: t("timezone"),
              today: t("todayBtn"),
              openRecord: t("openRecord"),
              openLesson: common("openLesson"),
              joinMeet: t("joinMeet"),
            }}
          />
        ) : (
          <MonthCalendar
            weeks={weeks}
            lessons={calendarLessons}
            timeZone={timeZone}
            monthLabel={month.label}
            prevMonth={prevMonth}
            nextMonth={nextMonth}
            todayYmd={todayYmd}
            selectedYmd={sp.day}
            locale={locale}
            labels={{
              timezone: t("timezone"),
              today: t("todayBtn"),
              openRecord: t("openRecord"),
              openLesson: common("openLesson"),
              joinMeet: t("joinMeet"),
              openPrep: t("openPrep"),
              finished: t("finished"),
              upcoming: t("upcoming"),
              noLessonsDay: t("noLessonsDay"),
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
