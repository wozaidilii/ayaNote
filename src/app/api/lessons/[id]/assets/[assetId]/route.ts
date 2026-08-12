import { NextResponse } from "next/server";
import { getAccessibleLesson } from "@/lib/classroom-access";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: lessonId, assetId } = await ctx.params;
  const access = await getAccessibleLesson(lessonId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const asset = await prisma.lessonAsset.findFirst({
    where: { id: assetId, lessonId },
  });
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(asset.data), {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.byteSize),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
