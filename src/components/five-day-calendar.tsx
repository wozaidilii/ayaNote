"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CalendarLessonItem } from "@/components/month-calendar";
import { formatInTz, wallTimeToUtc, ymdInTz } from "@/lib/timezone";

const HOUR_START = 0;
const HOUR_END = 24;
const PX_PER_HOUR = 40;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);

function minutesFromDayStart(
  iso: string,
  ymd: string,
  timeZone: string,
): number {
  const start = wallTimeToUtc(ymd, "00:00", timeZone).getTime();
  return (new Date(iso).getTime() - start) / 60_000;
}

export function FiveDayCalendar({
  days,
  lessons,
  timeZone,
  todayYmd,
  prevStart,
  nextStart,
  labels,
}: {
  days: string[]; // yyyy-MM-dd × 5
  lessons: CalendarLessonItem[];
  timeZone: string;
  todayYmd: string;
  prevStart: string;
  nextStart: string;
  labels: {
    timezone: string;
    today: string;
    openRecord: string;
    openLesson: string;
  };
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  return (
    <div className="day5-cal">
      <div className="month-cal-toolbar">
        <div className="month-cal-nav">
          <Link
            className="btn ghost"
            href={`/calendar?view=days&start=${prevStart}`}
            aria-label="Previous days"
          >
            ‹
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
            ›
          </Link>
          <Link
            className="btn secondary"
            href={`/calendar?view=days&start=${todayYmd}`}
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
                <div className="day5-col-body" style={{ height: gridHeight }}>
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
                    return (
                      <Link
                        key={ev.id}
                        href={`/classroom/${ev.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`day5-event ${past ? "is-past" : "is-upcoming"}`}
                        style={{ top, height }}
                        title={`${formatInTz(ev.startsAt, "HH:mm", timeZone)} ${ev.studentName}`}
                      >
                        <div className="day5-event-time">
                          {formatInTz(ev.startsAt, "HH:mm", timeZone)}
                        </div>
                        <div className="day5-event-name">{ev.studentName}</div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
