import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkBookingConflict,
  isHalfHourAlignedMinute,
  selectBookingNotices,
} from "../src/lib/booking.ts";

describe("booking", () => {
  it("detects overlapping lessons", () => {
    const start = new Date("2026-08-04T06:00:00.000Z");
    const end = new Date("2026-08-04T07:00:00.000Z");
    const result = checkBookingConflict({
      requestedStart: start,
      requestedEnd: end,
      existing: [
        {
          id: "l1",
          startsAt: new Date("2026-08-04T06:30:00.000Z"),
          endsAt: new Date("2026-08-04T07:30:00.000Z"),
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.conflictingLessonId, "l1");
  });

  it("allows touching edges and excluded reschedule target", () => {
    const start = new Date("2026-08-04T07:00:00.000Z");
    const end = new Date("2026-08-04T08:00:00.000Z");
    const okEdge = checkBookingConflict({
      requestedStart: start,
      requestedEnd: end,
      existing: [
        {
          id: "l1",
          startsAt: new Date("2026-08-04T06:00:00.000Z"),
          endsAt: new Date("2026-08-04T07:00:00.000Z"),
        },
      ],
    });
    assert.equal(okEdge.ok, true);

    const okExclude = checkBookingConflict({
      requestedStart: start,
      requestedEnd: end,
      existing: [{ id: "l2", startsAt: start, endsAt: end }],
      excludeLessonId: "l2",
    });
    assert.equal(okExclude.ok, true);
  });

  it("validates half-hour alignment", () => {
    assert.equal(isHalfHourAlignedMinute("00"), true);
    assert.equal(isHalfHourAlignedMinute("30"), true);
    assert.equal(isHalfHourAlignedMinute("15"), false);
  });

  it("selects recent approved/declined notices", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const notices = selectBookingNotices(
      [
        {
          id: "1",
          type: "book",
          status: "approved",
          requestedStart: new Date("2026-08-05T01:00:00.000Z"),
          updatedAt: new Date("2026-08-03T10:00:00.000Z"),
          note: "ok",
        },
        {
          id: "2",
          type: "book",
          status: "pending",
          requestedStart: new Date("2026-08-06T01:00:00.000Z"),
          updatedAt: new Date("2026-08-04T11:00:00.000Z"),
          note: "",
        },
        {
          id: "3",
          type: "reschedule",
          status: "declined",
          requestedStart: new Date("2026-07-01T01:00:00.000Z"),
          updatedAt: new Date("2026-07-01T12:00:00.000Z"),
          note: "old",
        },
      ],
      { now, withinDays: 14, limit: 5 },
    );
    assert.deepEqual(
      notices.map((n) => n.id),
      ["1"],
    );
  });
});
