import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { StudentsWorkspace } from "@/components/students-workspace";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentsPage() {
  const teacher = await requireTeacher();
  const [t, common] = await Promise.all([
    getTranslations("students"),
    getTranslations("common"),
  ]);

  const [rows, levelRows] = await Promise.all([
    prisma.student.findMany({
      where: { teacherId: teacher.id },
      include: { progress: true },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { teacherId: teacher.id },
      select: { level: true },
      distinct: ["level"],
    }),
  ]);

  const students = rows.map((student) => ({
    id: student.id,
    name: student.name,
    email: student.email,
    level: student.level,
    courseType: student.courseType,
    archivedAt: student.archivedAt?.toISOString() ?? null,
    attendanceCount: student.progress?.attendanceCount ?? 0,
    weaknesses: parseJsonArray(student.progress?.weaknessesJson),
  }));

  const levels = levelRows.map((l) => l.level).filter(Boolean);

  return (
    <AppShell active="students" personName={teacher.name}>
      <StudentsWorkspace
        students={students}
        levels={levels}
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          addStudent: t("addStudent"),
          name: t("name"),
          email: t("email"),
          create: t("create"),
          search: t("search"),
          searchPlaceholder: t("searchPlaceholder"),
          filterLevel: t("filterLevel"),
          allLevels: t("allLevels"),
          showArchived: t("showArchived"),
          archived: t("archived"),
          consent: t("consent"),
          close: t("close"),
          course: common("course"),
          level: common("level"),
          goals: common("goals"),
          attendance: common("attendance"),
          noItems: common("noItems"),
          open: t("open"),
        }}
      />
    </AppShell>
  );
}
