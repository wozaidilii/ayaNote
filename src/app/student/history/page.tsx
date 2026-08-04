import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentHistoryPage() {
  const active = await getActiveStudent();
  const [t, common, student] = await Promise.all([
    getTranslations("studentHistory"),
    getTranslations("common"),
    prisma.student.findFirstOrThrow({
      where: { id: active.id },
      include: {
        teacher: { select: { timezone: true } },
        lessons: {
          where: {
            status: "completed",
            summary: { is: { approved: true } },
          },
          include: { summary: true },
          orderBy: { startsAt: "desc" },
        },
      },
    }),
  ]);

  const timeZone = normalizeTimezone(student.teacher.timezone);

  return (
    <AppShell active="history" personName={student.name}>
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {t("subtitle")} · {student.name} · {timeZone}
      </p>
      <div className="panel" style={{ marginTop: "1.2rem" }}>
        {student.lessons.length === 0 && <p className="muted">{common("noItems")}</p>}
        {student.lessons.map((lesson) => (
          <div className="list-row" key={lesson.id}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
              </div>
              <div className="muted">
                {common("topics")}:{" "}
                {lesson.summary ? parseJsonArray(lesson.summary.topicsJson).join(" · ") : "—"}
              </div>
              <div>
                {common("homework")}: {lesson.summary?.homework || "—"}
              </div>
              <div>
                {common("nextFocus")}: {lesson.summary?.nextFocus || "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
