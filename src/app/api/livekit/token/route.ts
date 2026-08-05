import { NextRequest, NextResponse } from "next/server";
import { getActiveStudentOrNull } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { readGuestSessionForLesson } from "@/lib/guest-session";
import { createLivekitToken, livekitConfigured } from "@/lib/livekit";
import { getSession } from "@/lib/session";

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

  const session = await getSession();

  if (session.role === "teacher" && session.teacherId) {
    if (lesson.teacherId !== session.teacherId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const issued = await createLivekitToken({
      lessonId,
      identity: `teacher_${session.teacherId}`,
      name: lesson.teacher.name || "Teacher",
    });
    return NextResponse.json({
      ...issued,
      role: "teacher",
      displayName: lesson.teacher.name,
    });
  }

  if (session.role === "student") {
    const student = await getActiveStudentOrNull();
    if (!student || student.teacherId !== lesson.teacherId) {
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

  const guest = await readGuestSessionForLesson(lessonId);
  if (guest) {
    const issued = await createLivekitToken({
      lessonId,
      identity: `guest_${guest.guestId}`,
      name: guest.name || "Guest",
    });
    return NextResponse.json({
      ...issued,
      role: "guest",
      displayName: guest.name,
    });
  }

  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
