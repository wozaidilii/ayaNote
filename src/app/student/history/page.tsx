import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { History, Video, UiIcon } from "@/components/icons";
import { EmptyState, PageHeading } from "@/components/ui-heading";
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
      <PageHeading
        icon={History}
        title={t("title")}
        subtitle={
          <>
            {t("subtitle")} · {student.name} · {timeZone}
          </>
        }
      />
      <div className="panel">
        {student.lessons.length === 0 ? (
          <EmptyState icon={History}>{common("noItems")}</EmptyState>
        ) : (
          student.lessons.map((lesson) => (
            <div className="list-row" key={lesson.id}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
                </div>
                <div className="muted">
                  {common("topics")}:{" "}
                  {lesson.summary
                    ? parseJsonArray(lesson.summary.topicsJson).join(" · ")
                    : "—"}
                </div>
                <div>
                  {common("homework")}: {lesson.summary?.homework || "—"}
                </div>
                <div>
                  {common("nextFocus")}: {lesson.summary?.nextFocus || "—"}
                </div>
              </div>
              <div className="list-row-actions">
                <a
                  className="btn secondary sm"
                  href={`/classroom/${lesson.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <UiIcon icon={Video} size={14} />
                  {t("viewClassroom")}
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
