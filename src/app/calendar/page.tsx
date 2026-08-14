import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { decideBooking, syncGoogleCalendar } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { CalendarUnassignedPanel } from "@/components/calendar-unassigned-panel";
import { FiveDayCalendar } from "@/components/five-day-calendar";
import {
  CalendarDays,
  Check,
  Clock3,
  RefreshCw,
  X,
  UiIcon,
} from "@/components/icons";
import {
  MonthCalendar,
  type CalendarLessonItem,
} from "@/components/month-calendar";
import { PageHeading, PanelTitle } from "@/components/ui-heading";
import {
  isCalendarInboxEmail,
  isCalendarPlaceholderEmail,
  isUnassignedLessonTags,
  listGoogleBusyIntervals,
} from "@/lib/calendar-sync";
import { prisma } from "@/lib/db";
import { googleConfigured } from "@/lib/google";
import { requireTeacher } from "@/lib/session";
import {
  consecutiveYmds,
  dayBoundsInTz,
  formatInTz,
  monthGridYm,
  normalizeTimezone,
  parseMonthParam,
  shiftMonth,
  shiftYmd,
  startOfWeekMondayYmd,
  wallTimeToUtc,
  ymdInTz,
} from "@/lib/timezone";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    day?: string;
    view?: string;
    start?: string;
    ok?: string;
    err?: string;
    bind?: string;
  }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const view = sp.view === "month" ? "month" : "days";

  const teacher = await requireTeacher();
  const teacherFull = await prisma.teacher.findUniqueOrThrow({
    where: { id: teacher.id },
    include: { availabilityRules: true },
  });

  const [t, common] = await Promise.all([
    getTranslations("calendar"),
    getTranslations("common"),
  ]);

  const timeZone = normalizeTimezone(
    teacherFull.timezone ||
      teacherFull.availabilityRules?.timezone ||
      "Asia/Tokyo",
  );
  const todayYmd = ymdInTz(now, timeZone);
  const month = parseMonthParam(
    sp.month,
    timeZone,
    now,
    teacherFull.locale || "ja",
  );
  const weeks = monthGridYm(month.year, month.monthIndex0, timeZone);
  const prevMonth = shiftMonth(month.year, month.monthIndex0, -1);
  const nextMonth = shiftMonth(month.year, month.monthIndex0, 1);

  const anchorYmd =
    sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : todayYmd;
  // Natural Mon–Sun week (not a rolling 7 days from today)
  const daysStart = startOfWeekMondayYmd(anchorYmd, timeZone);
  const weekDays = consecutiveYmds(daysStart, 7, timeZone);
  const prevStart = shiftYmd(daysStart, -7, timeZone);
  const nextStart = shiftYmd(daysStart, 7, timeZone);
  const thisWeekStart = startOfWeekMondayYmd(todayYmd, timeZone);

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

  const daysRangeStart = dayBoundsInTz(weekDays[0], timeZone).start;
  const daysRangeEnd = dayBoundsInTz(
    shiftYmd(weekDays[weekDays.length - 1], 1, timeZone),
    timeZone,
  ).start;

  const rangeStart = view === "month" ? monthPaddedStart : daysRangeStart;
  const rangeEnd = view === "month" ? monthPaddedEnd : daysRangeEnd;

  const [lessons, pending, students, googleBusy] = await Promise.all([
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
    prisma.student.findMany({
      where: { teacherId: teacher.id, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    listGoogleBusyIntervals(teacherFull, rangeStart, rangeEnd),
  ]);

  const realStudents = students.filter(
    (s) =>
      !isCalendarInboxEmail(s.email) && !isCalendarPlaceholderEmail(s.email),
  );

  const googleConnected = Boolean(teacherFull.googleRefreshToken);
  const gcalReady = googleConfigured();

  const calendarLessons: CalendarLessonItem[] = lessons.map((lesson) => {
    const unassigned =
      isUnassignedLessonTags(lesson.tagsJson) ||
      isCalendarInboxEmail(lesson.student.email) ||
      isCalendarPlaceholderEmail(lesson.student.email);
    return {
      id: lesson.id,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      studentName: unassigned ? t("unassignedStudent") : lesson.student.name,
      status: lesson.status,
      prepStatus: lesson.prepStatus,
      hasSummary: Boolean(lesson.summary),
      unassigned,
      kind: "lesson" as const,
    };
  });

  const lessonBusyKeys = new Set(
    lessons.map((l) => `${l.startsAt.toISOString()}|${l.endsAt.toISOString()}`),
  );
  for (const block of googleBusy) {
    const key = `${block.start.toISOString()}|${block.end.toISOString()}`;
    if (lessonBusyKeys.has(key)) continue;
    const overlapsLesson = lessons.some(
      (l) => l.startsAt < block.end && block.start < l.endsAt,
    );
    if (overlapsLesson) continue;
    calendarLessons.push({
      id: `busy-${block.start.toISOString()}`,
      startsAt: block.start.toISOString(),
      endsAt: block.end.toISOString(),
      studentName: t("googleBusy"),
      status: "scheduled",
      kind: "busy",
    });
  }

  const unmatched = lessons.filter(
    (lesson) =>
      isUnassignedLessonTags(lesson.tagsJson) ||
      isCalendarInboxEmail(lesson.student.email) ||
      isCalendarPlaceholderEmail(lesson.student.email),
  );

  const locale = teacherFull.locale || "ja";

  return (
    <AppShell active="calendar" personName={teacher.name}>
      <PageHeading
        icon={CalendarDays}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="chip">{timeZone}</span>
            {!gcalReady ? (
              <span className="chip">{t("googleNotConfigured")}</span>
            ) : googleConnected ? (
              <form action={syncGoogleCalendar}>
                <button className="btn" type="submit">
                  <UiIcon icon={RefreshCw} size={15} />
                  {t("syncGoogle")}
                </button>
              </form>
            ) : (
              <a className="btn" href="/api/google/connect">
                <UiIcon icon={RefreshCw} size={15} />
                {t("connectGoogle")}
              </a>
            )}
          </div>
        }
      />

      <div className="panel">
        <PanelTitle icon={CalendarDays}>{t("localCalendar")}</PanelTitle>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("syncNote")}
        </p>
        {sp.ok === "scheduled" && (
          <p className="chip done" style={{ marginTop: "0.75rem" }}>
            {t("okScheduled")}
          </p>
        )}
        {sp.err === "conflict" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errConflict")}
          </p>
        )}
        {sp.err === "schedule" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errSchedule")}
          </p>
        )}
        {sp.ok === "synced" && (
          <p className="chip done" style={{ marginTop: "0.75rem" }}>
            {t("okSynced")}
          </p>
        )}
        {sp.ok === "google_connected" && (
          <p className="chip done" style={{ marginTop: "0.75rem" }}>
            {t("okGoogleConnected")}
          </p>
        )}
        {sp.ok === "bound" && (
          <p className="chip done" style={{ marginTop: "0.75rem" }}>
            {t("okBound")}
          </p>
        )}
        {sp.err === "google_not_configured" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errGoogleNotConfigured")}
          </p>
        )}
        {sp.err === "google_denied" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errGoogleDenied")}
          </p>
        )}
        {sp.err === "google_oauth" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errGoogleOauth")}
          </p>
        )}
        {sp.err === "not_connected" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errNotConnected")}
          </p>
        )}
        {sp.err === "sync" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errSync")}
          </p>
        )}
        {sp.err === "bind" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errBind")}
          </p>
        )}
        {sp.err === "student" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errStudent")}
          </p>
        )}
        {sp.err === "student_exists" && (
          <p className="chip" style={{ marginTop: "0.75rem" }}>
            {t("errStudentExists")}
          </p>
        )}
        {googleConnected && teacherFull.googleConnectedEmail && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {t("googleConnectedAs", {
              email: teacherFull.googleConnectedEmail,
            })}
          </p>
        )}
      </div>

      <CalendarUnassignedPanel
        lessons={unmatched.map((lesson) => ({
          id: lesson.id,
          startsAt: lesson.startsAt.toISOString(),
          endsAt: lesson.endsAt.toISOString(),
          title: t("unassignedStudent"),
        }))}
        students={realStudents}
        timeLabels={Object.fromEntries(
          unmatched.map((lesson) => [
            lesson.id,
            `${formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}–${formatInTz(lesson.endsAt, "HH:mm", timeZone)}`,
          ]),
        )}
        bindId={sp.bind}
        returnStart={view === "days" ? daysStart : todayYmd.slice(0, 7)}
        view={view}
        labels={{
          title: t("unassignedTitle"),
          hint: t("unassignedHint"),
          pickExisting: t("pickExisting"),
          createNew: t("createNewStudent"),
          name: t("studentName"),
          email: t("studentEmail"),
          password: t("studentPassword"),
          level: t("studentLevel"),
          course: t("studentCourse"),
          bind: t("bindStudent"),
          createAndBind: t("createAndBind"),
          selectStudentPlaceholder: t("selectStudentPlaceholder"),
          noStudents: t("noStudents"),
        }}
      />

      {pending.length > 0 && (
        <div className="panel">
          <PanelTitle
            icon={Clock3}
            trailing={<span className="chip soon">{pending.length}</span>}
          >
            {t("pending")}
          </PanelTitle>
          {pending.map((b) => (
            <div className="list-row" key={b.id}>
              <div className="list-row-main">
                <div className="list-row-title">
                  {b.student.name} · {b.type}
                </div>
                <div className="list-row-meta">
                  {formatInTz(b.requestedStart, "yyyy-MM-dd HH:mm", timeZone)}
                </div>
              </div>
              <div className="list-row-actions">
                <form action={decideBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="btn sm" type="submit">
                    <UiIcon icon={Check} size={14} />
                    {common("approve")}
                  </button>
                </form>
                <form action={decideBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="decision" value="decline" />
                  <button className="btn danger sm" type="submit">
                    <UiIcon icon={X} size={14} />
                    {common("decline")}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div
          className="cal-view-tabs"
          role="tablist"
          aria-label="Calendar view"
        >
          <Link
            className={`btn ${view === "days" ? "" : "secondary"}`}
            href={`/calendar?view=days&start=${thisWeekStart}`}
            role="tab"
            aria-selected={view === "days"}
          >
            <UiIcon icon={CalendarDays} size={14} />
            {t("viewWeek")}
          </Link>
          <Link
            className={`btn ${view === "month" ? "" : "secondary"}`}
            href={`/calendar?view=month&month=${todayYmd.slice(0, 7)}`}
            role="tab"
            aria-selected={view === "month"}
          >
            <UiIcon icon={CalendarDays} size={14} />
            {t("viewMonth")}
          </Link>
        </div>

        {view === "days" ? (
          <FiveDayCalendar
            days={weekDays}
            lessons={calendarLessons}
            students={realStudents}
            timeZone={timeZone}
            todayYmd={todayYmd}
            weekStartYmd={thisWeekStart}
            prevStart={prevStart}
            nextStart={nextStart}
            labels={{
              timezone: t("timezone"),
              today: t("todayBtn"),
              openRecord: t("openRecord"),
              openLesson: common("openLesson"),
              scheduleTitle: t("scheduleTitle"),
              scheduleHint: t("scheduleHint"),
              selectStudent: t("selectStudent"),
              selectStudentPlaceholder: t("selectStudentPlaceholder"),
              noStudents: t("noStudents"),
              confirmSchedule: t("confirmSchedule"),
              cancelSchedule: t("cancelSchedule"),
              close: t("close"),
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
              openPrep: t("openPrep"),
              finished: t("finished"),
              upcoming: t("upcoming"),
              noLessonsDay: t("noLessonsDay"),
              unassigned: t("unassignedStudent"),
              bindStudent: t("bindStudent"),
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
