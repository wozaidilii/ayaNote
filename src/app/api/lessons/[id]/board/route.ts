import { NextRequest, NextResponse } from "next/server";
import { getAccessibleLesson } from "@/lib/classroom-access";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export type ClassroomBoardPayload = {
  warmup: string;
  review: string;
  newFocus: string;
  practice: string;
  homeworkSeed: string;
  classroomNotes: string;
  prepUpdatedAt: string | null;
  notesUpdatedAt: string;
  lessonUpdatedAt: string;
};

function boardFromLesson(lesson: {
  classroomNotes: string;
  updatedAt: Date;
  prepDraft: {
    warmup: string;
    review: string;
    newFocus: string;
    practice: string;
    homeworkSeed: string;
    updatedAt: Date;
  } | null;
}): ClassroomBoardPayload {
  return {
    warmup: lesson.prepDraft?.warmup ?? "",
    review: lesson.prepDraft?.review ?? "",
    newFocus: lesson.prepDraft?.newFocus ?? "",
    practice: lesson.prepDraft?.practice ?? "",
    homeworkSeed: lesson.prepDraft?.homeworkSeed ?? "",
    classroomNotes: lesson.classroomNotes ?? "",
    prepUpdatedAt: lesson.prepDraft?.updatedAt.toISOString() ?? null,
    notesUpdatedAt: lesson.updatedAt.toISOString(),
    lessonUpdatedAt: lesson.updatedAt.toISOString(),
  };
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
  return NextResponse.json(boardFromLesson(access.lesson));
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

  let body: Partial<ClassroomBoardPayload>;
  try {
    body = (await req.json()) as Partial<ClassroomBoardPayload>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const warmup = String(body.warmup ?? access.lesson.prepDraft?.warmup ?? "");
  const review = String(body.review ?? access.lesson.prepDraft?.review ?? "");
  const newFocus = String(
    body.newFocus ?? access.lesson.prepDraft?.newFocus ?? "",
  );
  const practice = String(
    body.practice ?? access.lesson.prepDraft?.practice ?? "",
  );
  const homeworkSeed = String(
    body.homeworkSeed ?? access.lesson.prepDraft?.homeworkSeed ?? "",
  );
  const classroomNotes = String(
    body.classroomNotes ?? access.lesson.classroomNotes ?? "",
  );

  const [lesson] = await prisma.$transaction([
    prisma.lesson.update({
      where: { id },
      data: { classroomNotes },
      include: { prepDraft: true },
    }),
    prisma.prepDraft.upsert({
      where: { lessonId: id },
      create: {
        lessonId: id,
        warmup,
        review,
        newFocus,
        practice,
        homeworkSeed,
        status: access.lesson.prepDraft?.status ?? "draft",
      },
      update: { warmup, review, newFocus, practice, homeworkSeed },
    }),
  ]);

  // Re-read with prep for consistent timestamps
  const fresh = await prisma.lesson.findUniqueOrThrow({
    where: { id },
    include: { prepDraft: true },
  });
  void lesson;

  return NextResponse.json(boardFromLesson(fresh));
}
