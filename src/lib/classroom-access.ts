import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL, getSession } from "@/lib/session";

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

  const { role } = await getSession();
  if (role === "teacher") {
    const teacher = await prisma.teacher.findUnique({
      where: { email: DEMO_TEACHER_EMAIL },
    });
    if (!teacher || lesson.teacherId !== teacher.id) {
      return { ok: false as const, status: 403 as const, error: "forbidden" };
    }
    return {
      ok: true as const,
      role: "teacher" as const,
      lesson,
      actorName: teacher.name,
    };
  }

  const student = await getActiveStudent();
  if (lesson.studentId !== student.id) {
    return { ok: false as const, status: 403 as const, error: "forbidden" };
  }
  return {
    ok: true as const,
    role: "student" as const,
    lesson,
    actorName: student.name,
  };
}
