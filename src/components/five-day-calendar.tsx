"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createLessonForStudent } from "@/app/actions";
import { ChevronLeft, ChevronRight, UiIcon, X } from "@/components/icons";
import type { CalendarLessonItem } from "@/components/month-calendar";
import { LESSON_MINUTES } from "@/lib/scheduling";
import { formatInTz, wallTimeToUtc, ymdInTz } from "@/lib/timezone";

const HOUR_START = 0;
const HOUR_END = 24;
const PX_PER_HOUR = 40;
const SLOT_STEP = 30;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);

export type CalendarStudentOption = {
  id: string;
  name: string;
};

function minutesFromDayStart(
  iso: string,
  ymd: string,
  timeZone: string,
): number {
  const start = wallTimeToUtc(ymd, "00:00", timeZone).getTime();
  return (new Date(iso).getTime() - start) / 60_000;
}

function snapMinutesFromClick(clientY: number, bodyTop: number): number {
  const y = clientY - bodyTop;
  const raw = HOUR_START * 60 + (y / PX_PER_HOUR) * 60;
  const snapped = Math.round(raw / SLOT_STEP) * SLOT_STEP;
  const lastStart = HOUR_END * 60 - LESSON_MINUTES;
  return Math.max(HOUR_START * 60, Math.min(lastStart, snapped));
}

function hmFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function FiveDayCalendar({
  days,
  lessons,
  students,
  timeZone,
  todayYmd,
  weekStartYmd,
  prevStart,
  nextStart,
  labels,
}: {
  days: string[]; // yyyy-MM-dd × 7 (Mon–Sun)
  lessons: CalendarLessonItem[];
  students: CalendarStudentOption[];
  timeZone: string;
  todayYmd: string;
  /** Monday of the week that contains today — used by the Today control */
  weekStartYmd: string;
  prevStart: string;
  nextStart: string;
  labels: {
    timezone: string;
    today: string;
    openRecord: string;
    openLesson: string;
    scheduleTitle: string;
    scheduleHint: string;
    selectStudent: string;
    selectStudentPlaceholder: string;
    noStudents: string;
    confirmSchedule: string;
    cancelSchedule: string;
    close: string;
  };
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<{ ymd: string; minutes: number } | null>(
    null,
  );

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarLessonItem[]>();
    for (const d of days) map.set(d, []);
    for (const lesson of lessons) {
      const key = ymdInTz(new Date(lesson.startsAt), timeZone);
      if (!map.has(key)) continue;
      map.get(key)!.push(lesson);
    }
    for (const list of map.values()) {
      list.sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
    }
    return map;
  }, [days, lessons, timeZone]);

  const nowYmd = ymdInTz(new Date(nowMs), timeZone);
  const nowMinutes = minutesFromDayStart(
    new Date(nowMs).toISOString(),
    nowYmd,
    timeZone,
  );
  const nowTop = ((nowMinutes - HOUR_START * 60) / 60) * PX_PER_HOUR;
  const showNowLine =
    days.includes(nowYmd) &&
    nowMinutes >= HOUR_START * 60 &&
    nowMinutes <= HOUR_END * 60;

  const gridHeight = (HOUR_END - HOUR_START) * PX_PER_HOUR;
  const draftTime = draft ? hmFromMinutes(draft.minutes) : "";
  const draftStartsAt = draft
    ? wallTimeToUtc(draft.ymd, draftTime, timeZone).toISOString()
    : "";
  const draftTop = draft
    ? ((draft.minutes - HOUR_START * 60) / 60) * PX_PER_HOUR
    : 0;
  const draftHeight = (LESSON_MINUTES / 60) * PX_PER_HOUR - 2;

  return (
    <div className="day5-cal">
      <div className="month-cal-toolbar">
        <div className="month-cal-nav">
          <Link
            className="btn ghost"
            href={`/calendar?view=days&start=${prevStart}`}
            aria-label="Previous days"
          >
            <UiIcon icon={ChevronLeft} size={18} />
          </Link>
          <h2 className="month-cal-title">
            {formatInTz(
              wallTimeToUtc(days[0], "12:00", timeZone),
              "M/d",
              timeZone,
            )}
            {" – "}
            {formatInTz(
              wallTimeToUtc(days[days.length - 1], "12:00", timeZone),
              "M/d",
              timeZone,
            )}
          </h2>
          <Link
            className="btn ghost"
            href={`/calendar?view=days&start=${nextStart}`}
            aria-label="Next days"
          >
            <UiIcon icon={ChevronRight} size={18} />
          </Link>
          <Link
            className="btn secondary"
            href={`/calendar?view=days&start=${weekStartYmd}`}
          >
            {labels.today}
          </Link>
        </div>
        <span className="chip sky">
          {labels.timezone}: {timeZone}
        </span>
      </div>

      <div className="day5-scroll">
        <div
          className="day5-grid"
          style={{ ["--day5-h" as string]: `${gridHeight}px` }}
        >
          <div className="day5-gutter">
            <div className="day5-corner" />
            <div className="day5-hours" style={{ height: gridHeight }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="day5-hour-label"
                  style={{ height: PX_PER_HOUR }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
            </div>
          </div>

          {days.map((ymd) => {
            const items = byDay.get(ymd) ?? [];
            const isToday = ymd === todayYmd || ymd === nowYmd;
            const dayNum = Number(ymd.slice(-2));
            const weekday = formatInTz(
              wallTimeToUtc(ymd, "12:00", timeZone),
              "EEE",
              timeZone,
            );

            return (
              <div
                key={ymd}
                className={`day5-col ${isToday ? "is-today" : ""}`}
              >
                <div className="day5-col-head">
                  <div className="day5-weekday">{weekday}</div>
                  <div className={`day5-daynum ${isToday ? "is-today" : ""}`}>
                    {dayNum}
                  </div>
                </div>
                <div
                  className="day5-col-body day5-col-body-bookable"
                  style={{ height: gridHeight }}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest(
                        "a.day5-event, .day5-event.is-busy",
                      )
                    ) {
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDraft({
                      ymd,
                      minutes: snapMinutesFromClick(e.clientY, rect.top),
                    });
                  }}
                >
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="day5-hour-line"
                      style={{ top: (h - HOUR_START) * PX_PER_HOUR }}
                    />
                  ))}

                  {showNowLine && ymd === nowYmd && (
                    <div
                      className="day5-now"
                      style={{ top: Math.max(0, nowTop) }}
                    >
                      <span className="day5-now-dot" />
                      <span className="day5-now-line" />
                    </div>
                  )}

                  {draft?.ymd === ymd && (
                    <div
                      className="day5-draft"
                      style={{ top: draftTop, height: draftHeight }}
                    >
                      <div className="day5-event-time">{draftTime}</div>
                      <div className="day5-event-name">
                        {labels.scheduleTitle}
                      </div>
                    </div>
                  )}

                  {items.map((ev) => {
                    const startMin = minutesFromDayStart(
                      ev.startsAt,
                      ymd,
                      timeZone,
                    );
                    const endMin = minutesFromDayStart(
                      ev.endsAt,
                      ymd,
                      timeZone,
                    );
                    const clampedStart = Math.max(startMin, HOUR_START * 60);
                    const clampedEnd = Math.min(endMin, HOUR_END * 60);
                    if (clampedEnd <= clampedStart) return null;
                    const top =
                      ((clampedStart - HOUR_START * 60) / 60) * PX_PER_HOUR;
                    const height = Math.max(
                      22,
                      ((clampedEnd - clampedStart) / 60) * PX_PER_HOUR - 2,
                    );
                    const past =
                      new Date(ev.endsAt).getTime() < nowMs ||
                      ev.status === "completed";
                    const busy = ev.kind === "busy";
                    const className = [
                      "day5-event",
                      busy
                        ? "is-busy"
                        : ev.unassigned
                          ? "is-unassigned"
                          : past
                            ? "is-past"
                            : "is-upcoming",
                    ].join(" ");
                    const title = `${formatInTz(ev.startsAt, "HH:mm", timeZone)} ${ev.studentName}`;
                    const inner = (
                      <>
                        <div className="day5-event-time">
                          {formatInTz(ev.startsAt, "HH:mm", timeZone)}
                        </div>
                        <div className="day5-event-name">{ev.studentName}</div>
                      </>
                    );
                    if (busy) {
                      return (
                        <div
                          key={ev.id}
                          className={className}
                          style={{ top, height }}
                          title={title}
                        >
                          {inner}
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={ev.id}
                        href={
                          ev.unassigned
                            ? `/calendar?view=days&bind=${ev.id}#bind-${ev.id}`
                            : `/classroom/${ev.id}`
                        }
                        target={ev.unassigned ? undefined : "_blank"}
                        rel={ev.unassigned ? undefined : "noreferrer"}
                        className={className}
                        style={{ top, height }}
                        title={title}
                      >
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`students-drawer-backdrop ${draft ? "is-open" : ""}`}
        onClick={() => setDraft(null)}
        aria-hidden={!draft}
      />
      <aside
        className={`students-drawer ${draft ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={labels.scheduleTitle}
        aria-hidden={!draft}
      >
        <div className="students-drawer-head">
          <h2>{labels.scheduleTitle}</h2>
          <button
            className="btn ghost sm"
            type="button"
            onClick={() => setDraft(null)}
          >
            <UiIcon icon={X} size={15} />
            {labels.close}
          </button>
        </div>
        <div className="students-drawer-body">
          {draft && (
            <>
              <p style={{ marginTop: 0, fontSize: "1.15rem", fontWeight: 700 }}>
                {formatInTz(draftStartsAt, "MMM d · HH:mm", timeZone)}
                <span className="muted" style={{ fontWeight: 500 }}>
                  {" "}
                  –{" "}
                  {formatInTz(
                    new Date(
                      new Date(draftStartsAt).getTime() +
                        LESSON_MINUTES * 60_000,
                    ).toISOString(),
                    "HH:mm",
                    timeZone,
                  )}
                </span>
              </p>
              <p className="muted">{labels.scheduleHint}</p>

              {students.length === 0 ? (
                <p className="muted">{labels.noStudents}</p>
              ) : (
                <form action={createLessonForStudent}>
                  <input type="hidden" name="startsAt" value={draftStartsAt} />
                  <input
                    type="hidden"
                    name="returnStart"
                    value={days[0] ?? weekStartYmd}
                  />
                  <div className="field">
                    <label htmlFor="schedule-student">
                      {labels.selectStudent}
                    </label>
                    <select
                      id="schedule-student"
                      name="studentId"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {labels.selectStudentPlaceholder}
                      </option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                      marginTop: "1rem",
                    }}
                  >
                    <button className="btn" type="submit">
                      {labels.confirmSchedule}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => setDraft(null)}
                    >
                      {labels.cancelSchedule}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
