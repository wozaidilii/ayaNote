import { NextRequest, NextResponse } from "next/server";
import { getAccessibleLesson } from "@/lib/classroom-access";
import {
  emptyClassroomDoc,
  parseClassroomDoc,
  seedClassroomDoc,
  serializeClassroomDoc,
  type TiptapDoc,
} from "@/lib/classroom-doc";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export type ClassroomDocPayload = {
  doc: TiptapDoc;
  updatedAt: string;
  seeded: boolean;
};

function resolveDoc(lesson: {
  classroomDoc: string;
  classroomNotes: string;
  updatedAt: Date;
  prepDraft: {
    warmup: string;
    review: string;
    newFocus: string;
    practice: string;
    homeworkSeed: string;
  } | null;
}): { doc: TiptapDoc; seeded: boolean; needsPersist: boolean } {
  const existing = parseClassroomDoc(lesson.classroomDoc);
  if (existing) {
    return { doc: existing, seeded: false, needsPersist: false };
  }

  const hasPrep = Boolean(
    lesson.prepDraft &&
    (lesson.prepDraft.warmup ||
      lesson.prepDraft.review ||
      lesson.prepDraft.newFocus ||
      lesson.prepDraft.practice ||
      lesson.prepDraft.homeworkSeed ||
      lesson.classroomNotes),
  );

  const doc = hasPrep
    ? seedClassroomDoc({
        warmup: lesson.prepDraft?.warmup,
        review: lesson.prepDraft?.review,
        newFocus: lesson.prepDraft?.newFocus,
        practice: lesson.prepDraft?.practice,
        homeworkSeed: lesson.prepDraft?.homeworkSeed,
        classroomNotes: lesson.classroomNotes,
      })
    : emptyClassroomDoc();

  return { doc, seeded: true, needsPersist: true };
}

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

  const resolved = resolveDoc(access.lesson);
  let updatedAt = access.lesson.updatedAt;

  if (resolved.needsPersist) {
    const saved = await prisma.lesson.update({
      where: { id },
      data: { classroomDoc: serializeClassroomDoc(resolved.doc) },
      select: { updatedAt: true },
    });
    updatedAt = saved.updatedAt;
  }

  const payload: ClassroomDocPayload = {
    doc: resolved.doc,
    updatedAt: updatedAt.toISOString(),
    seeded: resolved.seeded,
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

  const saved = await prisma.lesson.update({
    where: { id },
    data: { classroomDoc: serializeClassroomDoc(body.doc) },
    select: { updatedAt: true, classroomDoc: true },
  });

  const payload: ClassroomDocPayload = {
    doc: parseClassroomDoc(saved.classroomDoc) ?? body.doc,
    updatedAt: saved.updatedAt.toISOString(),
    seeded: false,
  };
  return NextResponse.json(payload);
}
