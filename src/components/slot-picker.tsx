"use client";

import { useState } from "react";
import { format } from "date-fns";
import { createBookingRequest } from "@/app/actions";
import { toDatetimeLocalValue } from "@/lib/scheduling";

type DayGroup = {
  dayKey: string;
  label: string;
  slots: string[]; // ISO
};

export function SlotPicker({
  days,
  labels,
  nextLessonId,
}: {
  days: DayGroup[];
  labels: {
    pickSlot: string;
    request: string;
    note: string;
    typeBook: string;
    typeReschedule: string;
    noSlots: string;
  };
  nextLessonId?: string;
}) {
  const [selected, setSelected] = useState<string>(days[0]?.slots[0] ?? "");
  const [type, setType] = useState<"book" | "reschedule">("book");

  return (
    <form className="panel" action={createBookingRequest} style={{ marginTop: "1.2rem" }}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="requestedStart" value={selected ? toDatetimeLocalValue(new Date(selected)) : ""} />
      {nextLessonId && type === "reschedule" && (
        <input type="hidden" name="lessonId" value={nextLessonId} />
      )}

      <div className="field">
        <label>Type</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn ghost"
            data-selected={type === "book"}
            onClick={() => setType("book")}
            style={type === "book" ? { background: "var(--sky)", color: "white" } : undefined}
          >
            {labels.typeBook}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setType("reschedule")}
            style={type === "reschedule" ? { background: "var(--coral)", color: "white" } : undefined}
          >
            {labels.typeReschedule}
          </button>
        </div>
      </div>

      <p style={{ fontWeight: 700, marginBottom: "0.6rem" }}>{labels.pickSlot}</p>
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
                  onClick={() => setSelected(iso)}
                >
                  {format(d, "HH:mm")}
                  <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>+1h</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="field" style={{ marginTop: "0.8rem" }}>
        <label htmlFor="note">{labels.note}</label>
        <textarea id="note" name="note" placeholder="Optional" />
      </div>

      <button className="btn" type="submit" disabled={!selected}>
        {labels.request}
      </button>
    </form>
  );
}
