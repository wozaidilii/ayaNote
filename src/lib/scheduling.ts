import { addDays, addHours, addMinutes, endOfWeek, format, isBefore, isSameDay, setHours, setMinutes, startOfDay, startOfWeek } from "date-fns";
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
  maxWeeklyLessons?: number;
};

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function weekKey(d: Date) {
  return startOfWeek(d, { weekStartsOn: 1 }).toISOString();
}

/** Generate bookable 1h slots starting on the hour or half-hour. */
export function generateAvailableSlots(opts: {
  rules: AvailabilityLike;
  busy: BusyInterval[];
  blackoutDates?: Date[];
  /** Existing scheduled lesson starts for the student (used for weekly caps). */
  studentLessonStarts?: Date[];
  from?: Date;
  days?: number;
}): Date[] {
  const from = opts.from ?? new Date();
  const days = opts.days ?? 14;
  const weekdays = parseJsonArray(opts.rules.weekdaysJson).map(Number);
  const { h: startH, m: startM } = parseHm(opts.rules.startTime);
  const { h: endH, m: endM } = parseHm(opts.rules.endTime);
  const minStart = addHours(from, opts.rules.minNoticeHours);
  const blackouts = opts.blackoutDates ?? [];
  const maxWeekly = opts.rules.maxWeeklyLessons ?? 99;
  const existingByWeek = new Map<string, number>();
  for (const start of opts.studentLessonStarts ?? []) {
    const key = weekKey(start);
    existingByWeek.set(key, (existingByWeek.get(key) ?? 0) + 1);
  }
  const offeredByWeek = new Map<string, number>();
  const slots: Date[] = [];

  for (let d = 0; d < days; d++) {
    const day = startOfDay(addDays(from, d));
    if (!weekdays.includes(day.getDay())) continue;
    if (blackouts.some((b) => isSameDay(startOfDay(b), day))) continue;

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
      if (conflict) continue;

      const key = weekKey(cursor);
      const used = (existingByWeek.get(key) ?? 0) + (offeredByWeek.get(key) ?? 0);
      if (used >= maxWeekly) continue;
      offeredByWeek.set(key, (offeredByWeek.get(key) ?? 0) + 1);
      slots.push(cursor);
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

export function countLessonsInWeek(starts: Date[], around: Date) {
  const weekStart = startOfWeek(around, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(around, { weekStartsOn: 1 });
  return starts.filter((s) => s >= weekStart && s <= weekEnd).length;
}

export const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun", labelJa: "日" },
  { value: 1, label: "Mon", labelJa: "月" },
  { value: 2, label: "Tue", labelJa: "火" },
  { value: 3, label: "Wed", labelJa: "水" },
  { value: 4, label: "Thu", labelJa: "木" },
  { value: 5, label: "Fri", labelJa: "金" },
  { value: 6, label: "Sat", labelJa: "土" },
] as const;
