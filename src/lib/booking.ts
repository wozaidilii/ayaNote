export type BusyLesson = {
  id: string;
  startsAt: Date;
  endsAt: Date;
};

export type BookingConflictResult =
  | { ok: true }
  | { ok: false; reason: "conflict"; conflictingLessonId: string };

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** True when a booking window collides with an existing non-excluded lesson. */
export function checkBookingConflict(opts: {
  requestedStart: Date;
  requestedEnd: Date;
  existing: BusyLesson[];
  excludeLessonId?: string | null;
}): BookingConflictResult {
  for (const lesson of opts.existing) {
    if (opts.excludeLessonId && lesson.id === opts.excludeLessonId) continue;
    if (
      intervalsOverlap(
        opts.requestedStart,
        opts.requestedEnd,
        lesson.startsAt,
        lesson.endsAt,
      )
    ) {
      return { ok: false, reason: "conflict", conflictingLessonId: lesson.id };
    }
  }
  return { ok: true };
}

export type BookingNotice = {
  id: string;
  type: string;
  status: "approved" | "declined" | "cancelled" | "pending";
  requestedStart: Date;
  updatedAt: Date;
  note: string;
};

/** Recent non-pending decisions for the student in-app feed. */
export function selectBookingNotices(
  bookings: BookingNotice[],
  opts: { now?: Date; withinDays?: number; limit?: number } = {},
): BookingNotice[] {
  const now = opts.now ?? new Date();
  const withinDays = opts.withinDays ?? 14;
  const limit = opts.limit ?? 5;
  const cutoff = now.getTime() - withinDays * 86_400_000;

  return bookings
    .filter((b) => b.status === "approved" || b.status === "declined")
    .filter((b) => b.updatedAt.getTime() >= cutoff)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
}

/** Validate lesson start alignment (:00 / :30) in a given timezone wall clock. */
export function isHalfHourAlignedMinute(minute: string): boolean {
  return minute === "00" || minute === "30";
}
