import { prisma } from "@/lib/db";
import { getSession, requireStudent } from "@/lib/session";

/** Resolve which student the lite portal is viewing (session-bound). */
export async function getActiveStudent() {
  return requireStudent();
}

/** Optional: return student if logged in as student, else null. */
export async function getActiveStudentOrNull() {
  const session = await getSession();
  if (
    !session.authenticated ||
    session.role !== "student" ||
    !session.studentId
  ) {
    return null;
  }
  return prisma.student.findFirst({
    where: { id: session.studentId, archivedAt: null },
  });
}

export async function listActiveStudentsForTeacher(teacherId: string) {
  return prisma.student.findMany({
    where: { teacherId, archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      lessons: {
        where: { status: "scheduled", startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
    },
  });
}
