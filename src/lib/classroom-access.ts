import { getActiveStudentOrNull } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

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
    if (!student || lesson.studentId !== student.id) {
      return { ok: false as const, status: 403 as const, error: "forbidden" };
    }
    return {
      ok: true as const,
      role: "student" as const,
      lesson,
      actorName: student.name,
    };
  }

  return { ok: false as const, status: 403 as const, error: "forbidden" };
}
