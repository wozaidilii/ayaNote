import { addDays, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export const TIMEZONE_OPTIONS = [
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (KST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "UTC", label: "UTC" },
] as const;

export function normalizeTimezone(tz?: string | null): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    // Throws RangeError for invalid IANA ids
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Format an absolute instant in the teacher's timezone. */
export function formatInTz(
  date: Date | string | number,
  pattern: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, normalizeTimezone(timeZone), pattern);
}

export function ymdInTz(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return formatInTz(date, "yyyy-MM-dd", timeZone);
}

export function weekdayInTz(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  // ISO: 1=Mon … 7=Sun → JS: 0=Sun … 6=Sat
  const iso = Number(formatInTz(date, "i", timeZone));
  return iso === 7 ? 0 : iso;
}

/** Convert wall-clock Y-M-D + H:M in `timeZone` to a UTC Date. */
export function wallTimeToUtc(
  ymd: string,
  hm: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return fromZonedTime(new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0), normalizeTimezone(timeZone));
}

/** Start/end of a calendar day in the given timezone, as UTC Dates. */
export function dayBoundsInTz(
  ymdOrDate: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): { start: Date; end: Date; ymd: string } {
  const tz = normalizeTimezone(timeZone);
  const ymd = typeof ymdOrDate === "string" ? ymdOrDate : ymdInTz(ymdOrDate, tz);
  const start = wallTimeToUtc(ymd, "00:00", tz);
  const end = addDays(start, 1);
  return { start, end, ymd };
}

/** Bounds for “today” through +extraDays in timezone. */
export function rollingDayWindowInTz(
  timeZone: string,
  extraDays = 2,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const tz = normalizeTimezone(timeZone);
  const todayYmd = ymdInTz(now, tz);
  const { start } = dayBoundsInTz(todayYmd, tz);
  const endYmd = ymdInTz(addDays(start, extraDays), tz);
  const { start: end } = dayBoundsInTz(endYmd, tz);
  return { start, end };
}

/** Month grid: weeks of yyyy-MM-dd (Mon–Sun), padded with adjacent months. */
export function monthGridYm(
  year: number,
  monthIndex0: number,
  timeZone: string = DEFAULT_TIMEZONE,
): { ymd: string; inMonth: boolean }[][] {
  const tz = normalizeTimezone(timeZone);
  const firstYmd = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-01`;
  const firstUtc = wallTimeToUtc(firstYmd, "12:00", tz);
  const firstWeekday = weekdayInTz(firstUtc, tz); // 0=Sun
  // Monday-first grid like Google Calendar (many locales)
  const mondayOffset = (firstWeekday + 6) % 7;
  const gridStart = addDays(wallTimeToUtc(firstYmd, "12:00", tz), -mondayOffset);

  const weeks: { ymd: string; inMonth: boolean }[][] = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    const week: { ymd: string; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const ymd = ymdInTz(cursor, tz);
      const [, m] = ymd.split("-").map(Number);
      week.push({ ymd, inMonth: m === monthIndex0 + 1 });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    // Stop early if we've left the month and filled at least 4 weeks
    if (w >= 3 && week.every((c) => !c.inMonth)) {
      weeks.pop();
      break;
    }
  }
  return weeks;
}

export function parseMonthParam(
  raw: string | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
  locale = "ja",
): { year: number; monthIndex0: number; label: string } {
  const tz = normalizeTimezone(timeZone);
  const labelPattern = locale.startsWith("ja") ? "yyyy年M月" : "MMMM yyyy";
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    if (m >= 1 && m <= 12) {
      const mid = wallTimeToUtc(`${raw}-15`, "12:00", tz);
      return {
        year: y,
        monthIndex0: m - 1,
        label: formatInTz(mid, labelPattern, tz),
      };
    }
  }
  const ymd = ymdInTz(now, tz);
  const [y, m] = ymd.split("-").map(Number);
  return {
    year: y,
    monthIndex0: m - 1,
    label: formatInTz(now, labelPattern, tz),
  };
}

export function shiftMonth(year: number, monthIndex0: number, delta: number): string {
  const d = new Date(Date.UTC(year, monthIndex0 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Zoned Date for reading .getHours() etc. after toZonedTime (internal). */
export function asZoned(date: Date, timeZone: string) {
  return toZonedTime(date, normalizeTimezone(timeZone));
}

export function parseIsoOrLocal(raw: string): Date {
  if (!raw) return new Date(NaN);
  // Prefer true ISO / Z
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw) || raw.includes("T")) {
    const d = parseISO(raw.includes("T") && !raw.includes(":") ? `${raw}:00` : raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(raw);
  return d;
}
