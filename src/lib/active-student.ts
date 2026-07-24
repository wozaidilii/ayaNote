import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { DEMO_STUDENT_EMAIL, DEMO_TEACHER_EMAIL } from "@/lib/session";

/** Resolve which student the lite portal is viewing. */
export async function getActiveStudent() {
  const jar = await cookies();
  const selectedId = jar.get("ayanote_student_id")?.value;

  if (selectedId) {
    const selected = await prisma.student.findFirst({
      where: { id: selectedId, archivedAt: null },
    });
    if (selected) return selected;
  }

  const teacher = await prisma.teacher.findUnique({ where: { email: DEMO_TEACHER_EMAIL } });
  if (!teacher) {
    return prisma.student.findFirstOrThrow({
      where: { email: DEMO_STUDENT_EMAIL, archivedAt: null },
    });
  }

  // Prefer a student who has an upcoming scheduled lesson (real calendar data).
  const withUpcoming = await prisma.student.findFirst({
    where: {
      teacherId: teacher.id,
      archivedAt: null,
      lessons: {
        some: { status: "scheduled", startsAt: { gte: new Date() } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (withUpcoming) return withUpcoming;

  const demo = await prisma.student.findFirst({
    where: { teacherId: teacher.id, email: DEMO_STUDENT_EMAIL, archivedAt: null },
  });
  if (demo) return demo;

  return prisma.student.findFirstOrThrow({
    where: { teacherId: teacher.id, archivedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function listActiveStudentsForTeacher() {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
  return prisma.student.findMany({
    where: { teacherId: teacher.id, archivedAt: null },
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
