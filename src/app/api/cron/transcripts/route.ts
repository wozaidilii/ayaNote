import { NextRequest, NextResponse } from "next/server";
import { summarizeTranscript } from "@/lib/ai";
import { prisma } from "@/lib/db";
import {
  exportDriveDocText,
  getValidAccessToken,
  listRecentDriveDocs,
} from "@/lib/google";
import { toJson } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Poll Drive for Meet transcripts after lessons end.
 * Secure with CRON_SECRET header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() - 15 * 60 * 1000); // ended at least 15m ago

  const lessons = await prisma.lesson.findMany({
    where: {
      transcriptStatus: "waiting_drive",
      status: { not: "cancelled" },
      endsAt: { gte: windowStart, lte: windowEnd },
    },
    include: {
      student: true,
      teacher: true,
      transcript: true,
    },
    take: 20,
  });

  const results: Array<{ lessonId: string; status: string; file?: string }> = [];

  for (const lesson of lessons) {
    try {
      const accessToken = await getValidAccessToken(lesson.teacher);
      if (!accessToken) {
        results.push({ lessonId: lesson.id, status: "no_google_token" });
        continue;
      }

      if (
        accessToken !== lesson.teacher.googleAccessToken ||
        !lesson.teacher.googleTokenExpiry ||
        lesson.teacher.googleTokenExpiry.getTime() <= Date.now() + 60_000
      ) {
        await prisma.teacher.update({
          where: { id: lesson.teacherId },
          data: {
            googleAccessToken: accessToken,
            googleTokenExpiry: new Date(Date.now() + 3500_000),
          },
        });
      }

      const nameHint = lesson.student.name.split(" ")[0] ?? lesson.student.name;
      const files = await listRecentDriveDocs({
        accessToken,
        folderId: lesson.teacher.googleTranscriptFolderId,
        query: nameHint,
      });

      // Prefer docs modified near lesson end (±3h)
      const endMs = lesson.endsAt.getTime();
      const candidates = files
        .map((f) => ({
          ...f,
          mod: f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0,
        }))
        .filter((f) => Math.abs(f.mod - endMs) < 3 * 60 * 60 * 1000)
        .sort((a, b) => Math.abs(a.mod - endMs) - Math.abs(b.mod - endMs));

      const hit =
        candidates[0] ??
        files.find(
          (f) =>
            f.name.toLowerCase().includes(nameHint.toLowerCase()) ||
            f.name.toLowerCase().includes("transcript") ||
            f.name.toLowerCase().includes("文字起こし"),
        );

      if (!hit) {
        results.push({ lessonId: lesson.id, status: "not_found" });
        continue;
      }

      const rawText = await exportDriveDocText(accessToken, hit.id);
      if (!rawText.trim()) {
        results.push({ lessonId: lesson.id, status: "empty_doc", file: hit.name });
        continue;
      }

      const summary = await summarizeTranscript(rawText);
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: {
          status: "completed",
          transcriptStatus: "imported",
          driveFileId: hit.id,
          transcript: {
            upsert: {
              create: { source: "drive_import", rawText, editedText: rawText },
              update: { source: "drive_import", rawText, editedText: rawText },
            },
          },
          summary: {
            upsert: {
              create: {
                topicsJson: toJson(summary.topics),
                vocabJson: toJson(summary.vocab),
                grammarJson: toJson(summary.grammar),
                mistakesJson: toJson(summary.mistakes),
                homework: summary.homework,
                nextFocus: summary.nextFocus,
                notes: summary.notes,
                approved: false,
              },
              update: {
                topicsJson: toJson(summary.topics),
                vocabJson: toJson(summary.vocab),
                grammarJson: toJson(summary.grammar),
                mistakesJson: toJson(summary.mistakes),
                homework: summary.homework,
                nextFocus: summary.nextFocus,
                notes: summary.notes,
                approved: false,
              },
            },
          },
        },
      });

      results.push({ lessonId: lesson.id, status: "imported", file: hit.name });
    } catch (e) {
      console.error("transcript cron lesson failed", lesson.id, e);
      results.push({ lessonId: lesson.id, status: "error" });
    }
  }

  return NextResponse.json({
    checked: lessons.length,
    results,
  });
}
