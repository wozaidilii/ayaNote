import { NextRequest, NextResponse } from "next/server";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { createLivekitToken, livekitConfigured } from "@/lib/livekit";
import { DEMO_TEACHER_EMAIL, getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!livekitConfigured()) {
    return NextResponse.json(
      { error: "livekit_not_configured" },
      { status: 503 },
    );
  }

  let body: { lessonId?: string };
  try {
    body = (await req.json()) as { lessonId?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const lessonId = String(body.lessonId ?? "");
  if (!lessonId) {
    return NextResponse.json({ error: "missing_lesson" }, { status: 400 });
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      teacher: { select: { id: true, email: true, name: true } },
      student: { select: { id: true, name: true, email: true } },
    },
  });
  if (!lesson) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { role } = await getSession();

  if (role === "teacher") {
    const teacher = await prisma.teacher.findUnique({
      where: { email: DEMO_TEACHER_EMAIL },
    });
    if (!teacher || lesson.teacherId !== teacher.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const issued = await createLivekitToken({
      lessonId,
      identity: `teacher_${teacher.id}`,
      name: teacher.name || "Teacher",
    });
    return NextResponse.json({
      ...issued,
      role: "teacher",
      displayName: teacher.name,
    });
  }

  const student = await getActiveStudent();
  if (lesson.studentId !== student.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const issued = await createLivekitToken({
    lessonId,
    identity: `student_${student.id}`,
    name: student.name || "Student",
  });
  return NextResponse.json({
    ...issued,
    role: "student",
    displayName: student.name,
  });
}
