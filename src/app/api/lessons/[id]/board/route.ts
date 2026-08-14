import { NextRequest, NextResponse } from "next/server";
import { getAccessibleLesson } from "@/lib/classroom-access";
import {
  bindClassroomDocToPrep,
  mergeClassroomBoardSave,
  parseClassroomDoc,
  serializeClassroomDoc,
  type TiptapDoc,
} from "@/lib/classroom-doc";
import { parsePrepRefs } from "@/lib/prep-refs";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export type ClassroomDocPayload = {
  doc: TiptapDoc;
  updatedAt: string;
  seeded: boolean;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const access = await getAccessibleLesson(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const cloze = parsePrepRefs(access.lesson.prepDraft?.refsJson).vocabRecall;
  const bound = bindClassroomDocToPrep(
    parseClassroomDoc(access.lesson.classroomDoc),
    cloze,
  );
  let updatedAt = access.lesson.updatedAt;

  if (bound.changed) {
    const saved = await prisma.lesson.update({
      where: { id },
      data: { classroomDoc: serializeClassroomDoc(bound.doc) },
      select: { updatedAt: true },
    });
    updatedAt = saved.updatedAt;
  }

  const payload: ClassroomDocPayload = {
    doc: bound.doc,
    updatedAt: updatedAt.toISOString(),
    seeded: bound.changed,
  };
  return NextResponse.json(payload);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const access = await getAccessibleLesson(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  let body: { doc?: TiptapDoc };
  try {
    body = (await req.json()) as { doc?: TiptapDoc };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    !body.doc ||
    body.doc.type !== "doc" ||
    !Array.isArray(body.doc.content)
  ) {
    return NextResponse.json({ error: "invalid_doc" }, { status: 400 });
  }

  const merged = mergeClassroomBoardSave(
    body.doc,
    parseClassroomDoc(access.lesson.classroomDoc),
    parsePrepRefs(access.lesson.prepDraft?.refsJson).vocabRecall,
  );

  const saved = await prisma.lesson.update({
    where: { id },
    data: { classroomDoc: serializeClassroomDoc(merged) },
    select: { updatedAt: true, classroomDoc: true },
  });

  const payload: ClassroomDocPayload = {
    doc: parseClassroomDoc(saved.classroomDoc) ?? merged,
    updatedAt: saved.updatedAt.toISOString(),
    seeded: false,
  };
  return NextResponse.json(payload);
}
