import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVE_MATCH_MIN_SCORE,
  nameHintsForStudent,
  pickBestDriveTranscript,
  scoreDriveFile,
} from "../src/lib/drive-match.ts";

describe("drive-match", () => {
  it("builds name hints from student display names", () => {
    const hints = nameHintsForStudent("[Alex] Tanaka さん");
    assert.ok(hints.includes("[Alex] Tanaka さん") || hints.some((h) => h.includes("Alex")));
    assert.ok(hints.some((h) => /Alex|Tanaka/i.test(h)));
    assert.ok(!hints.includes("さん"));
  });

  it("scores files higher when name + time align", () => {
    const endsAt = new Date("2026-08-04T08:00:00.000Z");
    const good = scoreDriveFile(
      {
        id: "1",
        name: "Alex Meet transcript",
        modifiedTime: "2026-08-04T08:20:00.000Z",
      },
      {
        endMs: endsAt.getTime(),
        hints: ["Alex"],
        windowMs: 4 * 60 * 60 * 1000,
      },
    );
    const poor = scoreDriveFile(
      {
        id: "2",
        name: "random notes",
        modifiedTime: "2026-07-01T08:00:00.000Z",
      },
      {
        endMs: endsAt.getTime(),
        hints: ["Alex"],
        windowMs: 4 * 60 * 60 * 1000,
      },
    );
    assert.ok(good > DRIVE_MATCH_MIN_SCORE);
    assert.ok(good > poor);
  });

  it("picks best transcript above the confidence floor", () => {
    const endsAt = new Date("2026-08-04T08:00:00.000Z");
    const picked = pickBestDriveTranscript(
      [
        { id: "a", name: "unrelated", modifiedTime: "2026-01-01T00:00:00.000Z" },
        {
          id: "b",
          name: "Alex 文字起こし",
          modifiedTime: "2026-08-04T08:10:00.000Z",
        },
      ],
      { endsAt, studentName: "Alex" },
    );
    assert.ok(picked);
    assert.equal(picked?.file.id, "b");
    assert.ok((picked?.score ?? 0) >= DRIVE_MATCH_MIN_SCORE);
  });

  it("returns null when nothing is confident enough", () => {
    const picked = pickBestDriveTranscript(
      [{ id: "a", name: "todo list", modifiedTime: "2020-01-01T00:00:00.000Z" }],
      { endsAt: new Date("2026-08-04T08:00:00.000Z"), studentName: "Alex" },
    );
    assert.equal(picked, null);
  });
});
