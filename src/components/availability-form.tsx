"use client";

import { useMemo, useState } from "react";
import { WEEKDAY_OPTIONS } from "@/lib/scheduling";
import { TIMEZONE_OPTIONS } from "@/lib/timezone";

export function AvailabilityForm({
  action,
  defaults,
  labels,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaults: {
    startTime: string;
    endTime: string;
    minNoticeHours: number;
    maxWeeklyLessons: number;
    weekdays: number[];
    timezone: string;
  };
  labels: {
    hours: string;
    weekdays: string;
    minNotice: string;
    maxWeekly: string;
    timezone: string;
    save: string;
  };
}) {
  const [weekdays, setWeekdays] = useState<number[]>(defaults.weekdays);
  const weekdaysJson = useMemo(() => JSON.stringify([...weekdays].sort((a, b) => a - b)), [weekdays]);

  function toggle(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  return (
    <form className="panel" action={action} style={{ marginTop: "1.2rem" }}>
      <input type="hidden" name="weekdaysJson" value={weekdaysJson} />
      <div className="field">
        <label htmlFor="timezone">{labels.timezone}</label>
        <select id="timezone" name="timezone" defaultValue={defaults.timezone}>
          {TIMEZONE_OPTIONS.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="startTime">{labels.hours} start</label>
          <input id="startTime" name="startTime" type="time" defaultValue={defaults.startTime} required />
        </div>
        <div className="field">
          <label htmlFor="endTime">{labels.hours} end</label>
          <input id="endTime" name="endTime" type="time" defaultValue={defaults.endTime} required />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="minNoticeHours">{labels.minNotice}</label>
          <input
            id="minNoticeHours"
            name="minNoticeHours"
            type="number"
            min={0}
            defaultValue={defaults.minNoticeHours}
          />
        </div>
        <div className="field">
          <label htmlFor="maxWeeklyLessons">{labels.maxWeekly}</label>
          <input
            id="maxWeeklyLessons"
            name="maxWeeklyLessons"
            type="number"
            min={1}
            defaultValue={defaults.maxWeeklyLessons}
          />
        </div>
      </div>
      <div className="field">
        <label>{labels.weekdays}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
          {WEEKDAY_OPTIONS.map((d) => {
            const on = weekdays.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                className="btn ghost"
                onClick={() => toggle(d.value)}
                style={
                  on
                    ? { background: "var(--blue)", color: "white", borderColor: "var(--blue)" }
                    : undefined
                }
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>
      <button className="btn" type="submit" disabled={weekdays.length === 0}>
        {labels.save}
      </button>
    </form>
  );
}
