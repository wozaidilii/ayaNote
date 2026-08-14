import { getActiveStudentOrNull } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { readGuestSessionForLesson } from "@/lib/guest-session";
import { getSession } from "@/lib/session";

export type ClassroomRole = "teacher" | "student" | "guest";

export async function getAccessibleLesson(lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      teacher: {
        select: { id: true, email: true, name: true, timezone: true },
      },
      student: {
        select: {
          id: true,
          name: true,
          email: true,
          level: true,
          courseType: true,
          goals: true,
        },
      },
      prepDraft: true,
      summary: true,
    },
  });
  if (!lesson)
    return { ok: false as const, status: 404 as const, error: "not_found" };

  const session = await getSession();
  if (session.role === "teacher" && session.teacherId) {
    if (lesson.teacherId !== session.teacherId) {
      return { ok: false as const, status: 403 as const, error: "forbidden" };
    }
    const teacher = await prisma.teacher.findUnique({
      where: { id: session.teacherId },
    });
    if (!teacher) {
      return { ok: false as const, status: 403 as const, error: "forbidden" };
    }
    return {
      ok: true as const,
      role: "teacher" as const,
      lesson,
      actorName: teacher.name,
    };
  }

  if (session.role === "student") {
    const student = await getActiveStudentOrNull();
    if (!student || student.id !== lesson.studentId) {
      return { ok: false as const, status: 403 as const, error: "forbidden" };
    }
    return {
      ok: true as const,
      role: "student" as const,
      lesson,
      actorName: student.name,
    };
  }

  const guest = await readGuestSessionForLesson(lessonId);
  if (guest) {
    return {
      ok: true as const,
      role: "guest" as const,
      lesson,
      actorName: guest.name,
      guestId: guest.guestId,
    };
  }

  return { ok: false as const, status: 403 as const, error: "forbidden" };
}

/** Lesson exists and can be joined as guest (no auth yet). */
export async function getLessonForGuestJoin(lessonId: string) {
  return prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      teacher: { select: { name: true, timezone: true } },
      student: { select: { name: true, courseType: true, level: true } },
    },
  });
}
