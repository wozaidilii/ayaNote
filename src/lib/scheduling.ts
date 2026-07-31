import {
  addDays,
  addHours,
  addMinutes,
  endOfWeek,
  format,
  isBefore,
  startOfWeek,
} from "date-fns";
import { parseJsonArray } from "@/lib/utils";
import {
  DEFAULT_TIMEZONE,
  dayBoundsInTz,
  formatInTz,
  normalizeTimezone,
  wallTimeToUtc,
  weekdayInTz,
  ymdInTz,
} from "@/lib/timezone";

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
  /** IANA timezone — wall-clock hours are interpreted in this zone */
  timezone?: string;
};

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function weekKey(d: Date, timeZone: string) {
  return formatInTz(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd", timeZone);
}

function addCalendarDaysYmd(ymd: string, days: number, timeZone: string): string {
  const noon = wallTimeToUtc(ymd, "12:00", timeZone);
  return ymdInTz(addDays(noon, days), timeZone);
}

function hmAdd(hm: string, minutes: number): string {
  const { h, m } = parseHm(hm);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function hmToMinutes(hm: string): number {
  const { h, m } = parseHm(hm);
  return h * 60 + m;
}

/** Generate bookable 1h slots starting on the hour or half-hour (in teacher timezone). */
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
  const tz = normalizeTimezone(opts.rules.timezone ?? DEFAULT_TIMEZONE);
  const weekdays = parseJsonArray(opts.rules.weekdaysJson).map(Number);
  const { h: startH, m: startM } = parseHm(opts.rules.startTime);
  const endMinutes = hmToMinutes(opts.rules.endTime);
  const startHm = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
  const minStart = addHours(from, opts.rules.minNoticeHours);
  const blackoutYmds = new Set(
    (opts.blackoutDates ?? []).map((b) => ymdInTz(b, tz)),
  );
  const maxWeekly = opts.rules.maxWeeklyLessons ?? 99;
  const existingByWeek = new Map<string, number>();
  for (const start of opts.studentLessonStarts ?? []) {
    const key = weekKey(start, tz);
    existingByWeek.set(key, (existingByWeek.get(key) ?? 0) + 1);
  }
  const offeredByWeek = new Map<string, number>();
  const slots: Date[] = [];

  const fromYmd = ymdInTz(from, tz);

  for (let d = 0; d < days; d++) {
    const ymd = addCalendarDaysYmd(fromYmd, d, tz);
    const noon = wallTimeToUtc(ymd, "12:00", tz);
    if (!weekdays.includes(weekdayInTz(noon, tz))) continue;
    if (blackoutYmds.has(ymd)) continue;

    for (
      let cursorHm = startHm;
      hmToMinutes(cursorHm) + LESSON_MINUTES <= endMinutes;
      cursorHm = hmAdd(cursorHm, SLOT_STEP_MINUTES)
    ) {
      const { m: minute } = parseHm(cursorHm);
      if (minute !== 0 && minute !== 30) continue;

      const cursor = wallTimeToUtc(ymd, cursorHm, tz);
      if (isBefore(cursor, minStart)) continue;

      const end = addMinutes(cursor, LESSON_MINUTES);
      const conflict = opts.busy.some((b) => overlaps(cursor, end, b.start, b.end));
      if (conflict) continue;

      const key = weekKey(cursor, tz);
      const used = (existingByWeek.get(key) ?? 0) + (offeredByWeek.get(key) ?? 0);
      if (used >= maxWeekly) continue;
      offeredByWeek.set(key, (offeredByWeek.get(key) ?? 0) + 1);
      slots.push(cursor);
    }
  }

  return slots;
}

export function groupSlotsByDay(
  slots: Date[],
  timeZone: string = DEFAULT_TIMEZONE,
): Array<{ dayKey: string; label: string; slots: Date[] }> {
  const tz = normalizeTimezone(timeZone);
  const map = new Map<string, Date[]>();
  for (const slot of slots) {
    const key = ymdInTz(slot, tz);
    const list = map.get(key) ?? [];
    list.push(slot);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([dayKey, daySlots]) => ({
    dayKey,
    label: formatInTz(daySlots[0], "EEE · MMM d", tz),
    slots: daySlots,
  }));
}

/** Prefer ISO for form submit so server timezone does not reinterpret wall time. */
export function toDatetimeLocalValue(date: Date) {
  return date.toISOString();
}

export function countLessonsInWeek(starts: Date[], around: Date) {
  const weekStart = startOfWeek(around, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(around, { weekStartsOn: 1 });
  return starts.filter((s) => s >= weekStart && s <= weekEnd).length;
}

/** Blackout date stored as UTC midnight of that calendar day in teacher TZ. */
export function blackoutDateFromYmd(ymd: string, timeZone: string = DEFAULT_TIMEZONE) {
  return dayBoundsInTz(ymd, timeZone).start;
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

/** @deprecated use formatInTz — kept for rare non-zoned labels */
export function formatLocal(date: Date, pattern: string) {
  return format(date, pattern);
}
