import { addDays, addHours, addMinutes, format, isBefore, setHours, setMinutes, startOfDay } from "date-fns";
import { parseJsonArray } from "@/lib/utils";

export const LESSON_MINUTES = 60;
export const SLOT_STEP_MINUTES = 30; // starts at :00 or :30

export type BusyInterval = { start: Date; end: Date };

export type AvailabilityLike = {
  weekdaysJson: string;
  startTime: string;
  endTime: string;
  minNoticeHours: number;
  slotMinutes?: number;
};

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

/** Generate bookable 1h slots starting on the hour or half-hour. */
export function generateAvailableSlots(opts: {
  rules: AvailabilityLike;
  busy: BusyInterval[];
  from?: Date;
  days?: number;
}): Date[] {
  const from = opts.from ?? new Date();
  const days = opts.days ?? 14;
  const weekdays = parseJsonArray(opts.rules.weekdaysJson).map(Number);
  const { h: startH, m: startM } = parseHm(opts.rules.startTime);
  const { h: endH, m: endM } = parseHm(opts.rules.endTime);
  const minStart = addHours(from, opts.rules.minNoticeHours);
  const slots: Date[] = [];

  for (let d = 0; d < days; d++) {
    const day = startOfDay(addDays(from, d));
    if (!weekdays.includes(day.getDay())) continue;

    const windowStart = setMinutes(setHours(day, startH), startM);
    const windowEnd = setMinutes(setHours(day, endH), endM);

    for (
      let cursor = windowStart;
      addMinutes(cursor, LESSON_MINUTES) <= windowEnd;
      cursor = addMinutes(cursor, SLOT_STEP_MINUTES)
    ) {
      const minute = cursor.getMinutes();
      if (minute !== 0 && minute !== 30) continue;
      if (isBefore(cursor, minStart)) continue;

      const end = addMinutes(cursor, LESSON_MINUTES);
      const conflict = opts.busy.some((b) => overlaps(cursor, end, b.start, b.end));
      if (!conflict) slots.push(cursor);
    }
  }

  return slots;
}

export function groupSlotsByDay(slots: Date[]): Array<{ dayKey: string; label: string; slots: Date[] }> {
  const map = new Map<string, Date[]>();
  for (const slot of slots) {
    const key = format(slot, "yyyy-MM-dd");
    const list = map.get(key) ?? [];
    list.push(slot);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([dayKey, daySlots]) => ({
    dayKey,
    label: format(daySlots[0], "EEE · MMM d"),
    slots: daySlots,
  }));
}

export function toDatetimeLocalValue(date: Date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}
