import Link from "next/link";
import { ChevronLeft, ChevronRight, UiIcon } from "@/components/icons";
import { formatInTz, wallTimeToUtc, ymdInTz } from "@/lib/timezone";

export type CalendarLessonItem = {
  id: string;
  startsAt: string; // ISO
  endsAt: string;
  studentName: string;
  status: string;
  prepStatus?: string;
  hasSummary?: boolean;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"] as const;

export function MonthCalendar({
  weeks,
  lessons,
  timeZone,
  monthLabel,
  prevMonth,
  nextMonth,
  todayYmd,
  selectedYmd,
  locale = "en",
  labels,
}: {
  weeks: { ymd: string; inMonth: boolean }[][];
  lessons: CalendarLessonItem[];
  timeZone: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  todayYmd: string;
  selectedYmd?: string;
  locale?: string;
  labels: {
    timezone: string;
    today: string;
    openRecord: string;
    openLesson: string;
    openPrep: string;
    finished: string;
    upcoming: string;
    noLessonsDay: string;
  };
}) {
  const byDay = new Map<string, CalendarLessonItem[]>();
  for (const lesson of lessons) {
    const key = ymdInTz(new Date(lesson.startsAt), timeZone);
    const list = byDay.get(key) ?? [];
    list.push(lesson);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  }

  const heads = locale.startsWith("ja") ? WEEKDAYS_JA : WEEKDAYS;
  const focusYmd =
    selectedYmd && byDay.has(selectedYmd) ? selectedYmd : todayYmd;
  const dayLessons = byDay.get(focusYmd) ?? [];
  const now = Date.now();

  return (
    <div className="month-cal">
      <div className="month-cal-toolbar">
        <div className="month-cal-nav">
          <Link
            className="btn ghost"
            href={`/calendar?month=${prevMonth}`}
            aria-label="Previous month"
          >
            <UiIcon icon={ChevronLeft} size={18} />
          </Link>
          <h2 className="month-cal-title">{monthLabel}</h2>
          <Link
            className="btn ghost"
            href={`/calendar?month=${nextMonth}`}
            aria-label="Next month"
          >
            <UiIcon icon={ChevronRight} size={18} />
          </Link>
          <Link
            className="btn secondary"
            href={`/calendar?month=${todayYmd.slice(0, 7)}&day=${todayYmd}`}
          >
            {labels.today}
          </Link>
        </div>
        <span className="chip sky">
          {labels.timezone}: {timeZone}
        </span>
      </div>

      <div className="month-cal-grid">
        {heads.map((h) => (
          <div key={h} className="month-cal-head">
            {h}
          </div>
        ))}
        {weeks.flatMap((week) =>
          week.map((cell) => {
            const items = byDay.get(cell.ymd) ?? [];
            const isToday = cell.ymd === todayYmd;
            const isSelected = cell.ymd === focusYmd;
            const dayNum = Number(cell.ymd.slice(-2));
            return (
              <Link
                key={cell.ymd}
                href={`/calendar?month=${cell.ymd.slice(0, 7)}&day=${cell.ymd}`}
                className={[
                  "month-cal-cell",
                  cell.inMonth ? "" : "is-out",
                  isToday ? "is-today" : "",
                  isSelected ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="month-cal-daynum">{dayNum}</div>
                <div className="month-cal-events">
                  {items.slice(0, 3).map((ev) => {
                    const past =
                      new Date(ev.endsAt).getTime() < now ||
                      ev.status === "completed";
                    return (
                      <div
                        key={ev.id}
                        className={`month-cal-event ${past ? "is-past" : "is-upcoming"}`}
                        title={`${formatInTz(ev.startsAt, "HH:mm", timeZone)} ${ev.studentName}`}
                      >
                        <span className="month-cal-event-time">
                          {formatInTz(ev.startsAt, "HH:mm", timeZone)}
                        </span>{" "}
                        {ev.studentName}
                      </div>
                    );
                  })}
                  {items.length > 3 && (
                    <div className="month-cal-more">+{items.length - 3}</div>
                  )}
                </div>
              </Link>
            );
          }),
        )}
      </div>

      <div className="month-cal-detail panel" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>
          {formatInTz(
            wallTimeToUtc(focusYmd, "12:00", timeZone),
            "EEE · yyyy-MM-dd",
            timeZone,
          )}
        </h3>
        {dayLessons.length === 0 && (
          <p className="muted">{labels.noLessonsDay}</p>
        )}
        {dayLessons.map((lesson) => {
          const past =
            new Date(lesson.endsAt).getTime() < now ||
            lesson.status === "completed";
          return (
            <div className="list-row" key={lesson.id}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {formatInTz(lesson.startsAt, "HH:mm", timeZone)}–
                  {formatInTz(lesson.endsAt, "HH:mm", timeZone)} ·{" "}
                  {lesson.studentName}
                </div>
                <div
                  style={{
                    marginTop: "0.35rem",
                    display: "flex",
                    gap: "0.35rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span className={`chip ${past ? "done" : "soon"}`}>
                    {past ? labels.finished : labels.upcoming}
                  </span>
                  {lesson.prepStatus && (
                    <span className="chip">Prep: {lesson.prepStatus}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                {!past && (
                  <Link
                    className="btn secondary"
                    href={`/prep?lesson=${lesson.id}#lesson-${lesson.id}`}
                  >
                    {labels.openPrep}
                  </Link>
                )}
                <a
                  className="btn ghost"
                  href={`/classroom/${lesson.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {past || lesson.hasSummary
                    ? labels.openRecord
                    : labels.openLesson}
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
