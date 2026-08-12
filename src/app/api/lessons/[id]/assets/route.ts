import { NextRequest, NextResponse } from "next/server";
import { getAccessibleLesson } from "@/lib/classroom-access";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // 4MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: lessonId } = await ctx.params;
  const access = await getAccessibleLesson(lessonId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  const blob = file as File;
  if (!ALLOWED.has(blob.type)) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  if (blob.size < 32 || blob.size > MAX_BYTES) {
    return NextResponse.json({ error: "invalid_size" }, { status: 413 });
  }

  const buf = Buffer.from(await blob.arrayBuffer());
  const uploadedBy =
    access.role === "teacher"
      ? `teacher`
      : access.role === "student"
        ? `student`
        : `guest:${access.guestId ?? ""}`;

  const asset = await prisma.lessonAsset.create({
    data: {
      lessonId,
      mimeType: blob.type,
      filename: (blob.name || "image").slice(0, 120),
      byteSize: buf.length,
      data: buf,
      uploadedBy,
    },
    select: { id: true },
  });

  return NextResponse.json({
    ok: true,
    id: asset.id,
    url: `/api/lessons/${lessonId}/assets/${asset.id}`,
  });
}
