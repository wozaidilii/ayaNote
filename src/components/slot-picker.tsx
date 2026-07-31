"use client";

import { useMemo, useState } from "react";
import { cancelBookingRequest, createBookingRequest } from "@/app/actions";
import { LESSON_MINUTES, toDatetimeLocalValue } from "@/lib/scheduling";
import { DEFAULT_TIMEZONE, formatInTz } from "@/lib/timezone";

type DayGroup = {
  dayKey: string;
  label: string;
  slots: string[]; // ISO
};

type BookingRow = {
  id: string;
  type: string;
  status: string;
  note: string;
  requestedStart: string;
};

export function SlotPicker({
  days,
  labels,
  nextLessonId,
  bookings,
  timeZone = DEFAULT_TIMEZONE,
}: {
  days: DayGroup[];
  labels: {
    pickSlot: string;
    request: string;
    note: string;
    typeBook: string;
    typeReschedule: string;
    noSlots: string;
    confirm: string;
    duration: string;
    cancel: string;
    myBookings: string;
  };
  nextLessonId?: string;
  bookings?: BookingRow[];
  timeZone?: string;
}) {
  const [selected, setSelected] = useState<string>(days[0]?.slots[0] ?? "");
  const [type, setType] = useState<"book" | "reschedule">("book");
  const [confirming, setConfirming] = useState(false);

  const selectedDate = useMemo(() => (selected ? new Date(selected) : null), [selected]);

  return (
    <>
      <form className="panel" action={createBookingRequest} style={{ marginTop: "1.2rem" }}>
        <input type="hidden" name="type" value={type} />
        <input
          type="hidden"
          name="requestedStart"
          value={selectedDate ? toDatetimeLocalValue(selectedDate) : ""}
        />
        {nextLessonId && type === "reschedule" && (
          <input type="hidden" name="lessonId" value={nextLessonId} />
        )}

        <div className="field">
          <label>Type</label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setType("book");
                setConfirming(false);
              }}
              style={type === "book" ? { background: "var(--sky)", color: "white" } : undefined}
            >
              {labels.typeBook}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setType("reschedule");
                setConfirming(false);
              }}
              style={type === "reschedule" ? { background: "var(--coral)", color: "white" } : undefined}
            >
              {labels.typeReschedule}
            </button>
          </div>
        </div>

        <p style={{ fontWeight: 700, marginBottom: "0.6rem" }}>
          {labels.pickSlot}{" "}
          <span className="chip sky" style={{ fontWeight: 600 }}>
            {timeZone}
          </span>
        </p>
        {days.length === 0 && <p className="muted">{labels.noSlots}</p>}

        {days.map((day) => (
          <div className="cal-day" key={day.dayKey}>
            <h3>{day.label}</h3>
            <div className="slot-grid">
              {day.slots.map((iso) => {
                const d = new Date(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    className="slot-btn"
                    data-selected={selected === iso}
                    onClick={() => {
                      setSelected(iso);
                      setConfirming(false);
                    }}
                  >
                    {formatInTz(d, "HH:mm", timeZone)}
                    <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>+1h</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {selectedDate && (
          <div className="panel" style={{ marginTop: "0.9rem", background: "var(--paper)" }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{labels.confirm}</p>
            <p style={{ margin: "0.4rem 0 0" }}>
              {formatInTz(selectedDate, "EEE · yyyy-MM-dd HH:mm", timeZone)} →{" "}
              {formatInTz(
                new Date(selectedDate.getTime() + LESSON_MINUTES * 60_000),
                "HH:mm",
                timeZone,
              )}
            </p>
            <p className="muted" style={{ margin: "0.25rem 0 0" }}>
              {labels.duration}: {LESSON_MINUTES} min · {timeZone}
            </p>
          </div>
        )}

        <div className="field" style={{ marginTop: "0.8rem" }}>
          <label htmlFor="note">{labels.note}</label>
          <textarea id="note" name="note" placeholder="Optional" />
        </div>

        {!confirming ? (
          <button
            className="btn secondary"
            type="button"
            disabled={!selected}
            onClick={() => setConfirming(true)}
          >
            {labels.confirm}
          </button>
        ) : (
          <button className="btn" type="submit" disabled={!selected}>
            {labels.request}
          </button>
        )}
      </form>

      {bookings && bookings.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{labels.myBookings}</h2>
          {bookings.map((b) => (
            <div className="list-row" key={b.id}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {b.type} · {formatInTz(b.requestedStart, "yyyy-MM-dd HH:mm", timeZone)} (+1h)
                </div>
                <div className="muted">{b.note || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <span className="chip">{b.status}</span>
                {b.status === "pending" && (
                  <form action={cancelBookingRequest}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="btn danger" type="submit">
                      {labels.cancel}
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
