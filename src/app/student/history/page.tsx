import { getTranslations } from "next-intl/server";
import { markHomeworkDone, retryHomeworkQuiz } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { History, Video, UiIcon } from "@/components/icons";
import { EmptyState, PageHeading } from "@/components/ui-heading";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { parseQuizJson } from "@/lib/homework-quiz";
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
          where: { status: "completed" },
          include: { summary: true, homeworks: true },
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
          student.lessons.map((lesson) => {
            const hw = lesson.homeworks[0];
            const qCount =
              hw?.kind === "quiz" ? parseQuizJson(hw.quizJson).length : 0;
            const isAssigned = hw?.status === "assigned";
            const isDone = hw?.status === "done" || hw?.status === "reviewed";
            return (
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
                    {common("homework")}:{" "}
                    {hw?.instructions || lesson.summary?.homework || "—"}
                  </div>
                  {hw ? (
                    <div style={{ marginTop: "0.35rem" }}>
                      <span className={`chip${isDone ? " done" : ""}`}>
                        {hw.status === "reviewed"
                          ? t("hwReviewed")
                          : hw.status === "done"
                            ? t("hwDone")
                            : t("hwAssigned")}
                      </span>
                      {isDone && hw.score != null && qCount > 0 ? (
                        <span
                          className="muted"
                          style={{ marginLeft: "0.5rem" }}
                        >
                          {t("score", { score: hw.score, total: qCount })}
                        </span>
                      ) : null}
                      {isAssigned ? (
                        <a
                          className="btn secondary sm"
                          href={`/student/homework/${hw.id}`}
                          style={{ marginLeft: "0.5rem" }}
                        >
                          {t("doHomework")}
                        </a>
                      ) : null}
                      {isDone && hw.kind === "quiz" ? (
                        <>
                          <a
                            className="btn ghost sm"
                            href={`/student/homework/${hw.id}`}
                            style={{ marginLeft: "0.5rem" }}
                          >
                            {t("reviewHomework")}
                          </a>
                          <form
                            action={retryHomeworkQuiz}
                            style={{ display: "inline", marginLeft: "0.35rem" }}
                          >
                            <input
                              type="hidden"
                              name="homeworkId"
                              value={hw.id}
                            />
                            <button className="btn secondary sm" type="submit">
                              {t("retry")}
                            </button>
                          </form>
                        </>
                      ) : null}
                      {isAssigned && hw.kind === "text" ? (
                        <form
                          action={markHomeworkDone}
                          style={{ display: "inline", marginLeft: "0.5rem" }}
                        >
                          <input
                            type="hidden"
                            name="homeworkId"
                            value={hw.id}
                          />
                          <button className="btn secondary sm" type="submit">
                            {t("markDone")}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                  {lesson.summary?.approved ? (
                    <div>
                      {common("nextFocus")}: {lesson.summary.nextFocus || "—"}
                    </div>
                  ) : null}
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
            );
          })
        )}
      </div>
    </AppShell>
  );
}
