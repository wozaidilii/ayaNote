import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAndImportDriveTranscript } from "@/lib/drive-transcript";

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
  const windowEnd = new Date(now.getTime() - 15 * 60 * 1000);

  const lessons = await prisma.lesson.findMany({
    where: {
      transcriptStatus: "waiting_drive",
      status: { not: "cancelled" },
      endsAt: { gte: windowStart, lte: windowEnd },
      student: { recordingConsent: true },
    },
    select: { id: true },
    take: 20,
  });

  const results: Array<{ lessonId: string; status: string; file?: string }> = [];

  for (const lesson of lessons) {
    const result = await fetchAndImportDriveTranscript(lesson.id);
    results.push({
      lessonId: lesson.id,
      status: result.status,
      file: result.fileName,
    });
  }

  return NextResponse.json({
    checked: lessons.length,
    results,
  });
}
