"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cancelBookingRequest, createBookingRequest } from "@/app/actions";
import { ChevronLeft, ChevronRight, UiIcon, X } from "@/components/icons";
import { LESSON_MINUTES, toDatetimeLocalValue } from "@/lib/scheduling";
import { formatInTz, wallTimeToUtc, ymdInTz } from "@/lib/timezone";

const HOUR_START = 0;
const HOUR_END = 24;
const PX_PER_HOUR = 40;
const SLOT_STEP = 30;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);

export type StudentCalBlock = {
  id: string;
  startsAt: string;
  endsAt: string;
  kind: "busy" | "mine" | "pending";
  label: string;
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

export function StudentBookCalendar({
  days,
  blocks,
  openSlotIsos,
  timeZone,
  todayYmd,
  weekStartYmd,
  prevStart,
  nextStart,
  nextLessonId,
  bookings,
  labels,
}: {
  days: string[];
  blocks: StudentCalBlock[];
  /** ISO strings of bookable starts in this view */
  openSlotIsos: string[];
  timeZone: string;
  todayYmd: string;
  weekStartYmd: string;
  prevStart: string;
  nextStart: string;
  nextLessonId?: string;
  bookings: Array<{
    id: string;
    type: string;
    status: string;
    note: string;
    requestedStart: string;
  }>;
  labels: {
    timezone: string;
    today: string;
    busy: string;
    yourLesson: string;
    yourPending: string;
    requestTitle: string;
    requestHint: string;
    request: string;
    note: string;
    typeBook: string;
    typeReschedule: string;
    confirm: string;
    cancel: string;
    close: string;
    duration: string;
    myBookings: string;
    slotTaken: string;
    slotUnavailable: string;
  };
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<{ ymd: string; minutes: number } | null>(
    null,
  );
  const [type, setType] = useState<"book" | "reschedule">("book");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const openSet = useMemo(() => new Set(openSlotIsos), [openSlotIsos]);

  const byDay = useMemo(() => {
    const map = new Map<string, StudentCalBlock[]>();
    for (const d of days) map.set(d, []);
    for (const block of blocks) {
      const key = ymdInTz(new Date(block.startsAt), timeZone);
      if (!map.has(key)) continue;
      map.get(key)!.push(block);
    }
    for (const list of map.values()) {
      list.sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
    }
    return map;
  }, [blocks, days, timeZone]);

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
  const draftOpen = draftStartsAt ? openSet.has(draftStartsAt) : false;

  return (
    <div className="day5-cal">
      <div className="month-cal-toolbar">
        <div className="month-cal-nav">
          <Link
            className="btn ghost"
            href={`/student/book?start=${prevStart}`}
            aria-label="Previous week"
          >
            <UiIcon icon={ChevronLeft} size={18} />
          </Link>
          <h2 className="month-cal-title">
            {formatInTz(
              wallTimeToUtc(days[0]!, "12:00", timeZone),
              "M/d",
              timeZone,
            )}
            {" – "}
            {formatInTz(
              wallTimeToUtc(days[days.length - 1]!, "12:00", timeZone),
              "M/d",
              timeZone,
            )}
          </h2>
          <Link
            className="btn ghost"
            href={`/student/book?start=${nextStart}`}
            aria-label="Next week"
          >
            <UiIcon icon={ChevronRight} size={18} />
          </Link>
          <Link
            className="btn secondary"
            href={`/student/book?start=${weekStartYmd}`}
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
                        "a.day5-event, .day5-event",
                      )
                    ) {
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const minutes = snapMinutesFromClick(e.clientY, rect.top);
                    const iso = wallTimeToUtc(
                      ymd,
                      hmFromMinutes(minutes),
                      timeZone,
                    ).toISOString();
                    setConfirming(false);
                    if (!openSet.has(iso)) {
                      const overlapsBusy = (byDay.get(ymd) ?? []).some((b) => {
                        const t = new Date(iso).getTime();
                        return (
                          t < new Date(b.endsAt).getTime() &&
                          t + LESSON_MINUTES * 60_000 >
                            new Date(b.startsAt).getTime()
                        );
                      });
                      setError(
                        overlapsBusy
                          ? labels.slotTaken
                          : labels.slotUnavailable,
                      );
                      setDraft({ ymd, minutes });
                      return;
                    }
                    setError(null);
                    setDraft({ ymd, minutes });
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
                      className={`day5-draft${draftOpen ? "" : " is-blocked"}`}
                      style={{ top: draftTop, height: draftHeight }}
                    >
                      <div className="day5-event-time">{draftTime}</div>
                      <div className="day5-event-name">
                        {draftOpen ? labels.requestTitle : labels.busy}
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
                    const cls =
                      ev.kind === "mine"
                        ? "is-mine"
                        : ev.kind === "pending"
                          ? "is-pending"
                          : "is-busy";
                    const inner = (
                      <>
                        <div className="day5-event-time">
                          {formatInTz(ev.startsAt, "HH:mm", timeZone)}
                        </div>
                        <div className="day5-event-name">{ev.label}</div>
                      </>
                    );
                    if (ev.kind === "mine") {
                      return (
                        <Link
                          key={ev.id}
                          href={`/classroom/${ev.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`day5-event ${cls}`}
                          style={{ top, height }}
                          title={ev.label}
                        >
                          {inner}
                        </Link>
                      );
                    }
                    return (
                      <div
                        key={ev.id}
                        className={`day5-event ${cls}`}
                        style={{ top, height }}
                        title={ev.label}
                      >
                        {inner}
                      </div>
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
        aria-label={labels.requestTitle}
        aria-hidden={!draft}
      >
        <div className="students-drawer-head">
          <h2>{labels.requestTitle}</h2>
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
              {!draftOpen || error ? (
                <p className="muted">{error || labels.slotTaken}</p>
              ) : (
                <>
                  <p className="muted">{labels.requestHint}</p>
                  <form action={createBookingRequest}>
                    <input type="hidden" name="type" value={type} />
                    <input
                      type="hidden"
                      name="requestedStart"
                      value={toDatetimeLocalValue(new Date(draftStartsAt))}
                    />
                    {nextLessonId && type === "reschedule" ? (
                      <input
                        type="hidden"
                        name="lessonId"
                        value={nextLessonId}
                      />
                    ) : null}
                    <div className="field">
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          className={`btn sm${type === "book" ? "" : " secondary"}`}
                          onClick={() => {
                            setType("book");
                            setConfirming(false);
                          }}
                        >
                          {labels.typeBook}
                        </button>
                        <button
                          type="button"
                          className={`btn sm${type === "reschedule" ? "" : " secondary"}`}
                          onClick={() => {
                            setType("reschedule");
                            setConfirming(false);
                          }}
                          disabled={!nextLessonId}
                        >
                          {labels.typeReschedule}
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="student-book-note">{labels.note}</label>
                      <textarea id="student-book-note" name="note" rows={3} />
                    </div>
                    <p className="muted" style={{ fontSize: "0.85rem" }}>
                      {labels.duration}: {LESSON_MINUTES} min
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                        marginTop: "1rem",
                      }}
                    >
                      {!confirming ? (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setConfirming(true)}
                        >
                          {labels.confirm}
                        </button>
                      ) : (
                        <button className="btn" type="submit">
                          {labels.request}
                        </button>
                      )}
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => setDraft(null)}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </aside>

      {bookings.length > 0 ? (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>{labels.myBookings}</h2>
          {bookings.map((b) => (
            <div className="list-row" key={b.id}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {b.type} ·{" "}
                  {formatInTz(b.requestedStart, "yyyy-MM-dd HH:mm", timeZone)}
                </div>
                <div className="muted">{b.note || "—"}</div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "0.4rem",
                  alignItems: "center",
                }}
              >
                <span className="chip">{b.status}</span>
                {b.status === "pending" ? (
                  <form action={cancelBookingRequest}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="btn danger sm" type="submit">
                      {labels.cancel}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
