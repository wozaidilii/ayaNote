import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentsPage() {
  const t = await getTranslations("students");
  const common = await getTranslations("common");
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
  const students = await prisma.student.findMany({
    where: { teacherId: teacher.id },
    include: { progress: true },
    orderBy: { name: "asc" },
  });

  return (
    <AppShell active="students">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <div className="panel" style={{ marginTop: "1.2rem" }}>
        {students.map((student) => (
          <div className="list-row" key={student.id}>
            <div>
              <div style={{ fontWeight: 700 }}>{student.name}</div>
              <div className="muted" style={{ fontSize: "0.9rem" }}>
                {common("level")}: {student.level} · {common("attendance")}:{" "}
                {student.progress?.attendanceCount ?? 0}
              </div>
              <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {parseJsonArray(student.progress?.weaknessesJson).slice(0, 3).map((w) => (
                  <span className="chip" key={w}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
            <Link className="btn secondary" href={`/students/${student.id}`}>
              Open
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
