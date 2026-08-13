import { getTranslations } from "next-intl/server";
import { retryHomeworkQuiz } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { BookOpen } from "@/components/icons";
import { PageHeading, PanelTitle } from "@/components/ui-heading";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { parseQuizJson } from "@/lib/homework-quiz";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";

export default async function StudentHomeworkListPage() {
  const active = await getActiveStudent();
  const [t, common, student] = await Promise.all([
    getTranslations("studentHome"),
    getTranslations("common"),
    prisma.student.findFirstOrThrow({
      where: { id: active.id },
      include: {
        teacher: { select: { timezone: true } },
        homeworks: {
          include: { lesson: { select: { startsAt: true } } },
          orderBy: { createdAt: "desc" },
          take: 40,
        },
      },
    }),
  ]);

  const timeZone = normalizeTimezone(student.teacher.timezone);
  const pending = student.homeworks.filter((hw) => hw.status === "assigned");
  const done = student.homeworks.filter(
    (hw) => hw.status === "done" || hw.status === "reviewed",
  );

  return (
    <AppShell active="homework" personName={student.name}>
      <PageHeading
        icon={BookOpen}
        title={common("homework")}
        subtitle={
          <>
            {student.name} · {timeZone}
          </>
        }
      />

      <div className="panel">
        <PanelTitle icon={BookOpen}>{t("pendingHomework")}</PanelTitle>
        {pending.length === 0 ? (
          <p className="muted">{t("noPendingHomework")}</p>
        ) : (
          pending.map((hw) => {
            const qCount =
              hw.kind === "quiz" ? parseQuizJson(hw.quizJson).length : 0;
            const isSample = hw.source === "sample_level";
            return (
              <div className="list-row" key={hw.id}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {isSample
                      ? t("levelCheck")
                      : hw.lesson
                        ? formatInTz(
                            hw.lesson.startsAt,
                            "yyyy-MM-dd HH:mm",
                            timeZone,
                          )
                        : hw.title || common("homework")}
                  </div>
                  <div className="muted">
                    {hw.title || common("homework")}
                    {qCount > 0
                      ? ` · ${t("quizQuestions", { count: qCount })}`
                      : ""}
                  </div>
                </div>
                <div className="list-row-actions">
                  <a className="btn sm" href={`/student/homework/${hw.id}`}>
                    {isSample ? t("startLevelCheck") : t("doHomework")}
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <PanelTitle icon={BookOpen}>{t("doneHomework")}</PanelTitle>
        {done.length === 0 ? (
          <p className="muted">{t("noDoneHomework")}</p>
        ) : (
          done.map((hw) => {
            const qCount =
              hw.kind === "quiz" ? parseQuizJson(hw.quizJson).length : 0;
            const isSample = hw.source === "sample_level";
            return (
              <div className="list-row" key={hw.id}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {isSample
                      ? t("levelCheck")
                      : hw.lesson
                        ? formatInTz(
                            hw.lesson.startsAt,
                            "yyyy-MM-dd HH:mm",
                            timeZone,
                          )
                        : hw.title || common("homework")}
                  </div>
                  <div className="muted">
                    {hw.title || common("homework")}
                    {hw.score != null && qCount > 0
                      ? ` · ${t("scoreLine", { score: hw.score, total: qCount })}`
                      : ""}
                  </div>
                </div>
                <div className="list-row-actions">
                  <a
                    className="btn secondary sm"
                    href={`/student/homework/${hw.id}`}
                  >
                    {t("viewResult")}
                  </a>
                  {hw.kind === "quiz" ? (
                    <form action={retryHomeworkQuiz}>
                      <input type="hidden" name="homeworkId" value={hw.id} />
                      <button className="btn sm" type="submit">
                        {t("retry")}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
