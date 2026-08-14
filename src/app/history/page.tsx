import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { BookOpen, History, Video, UiIcon } from "@/components/icons";
import { EmptyState, PageHeading } from "@/components/ui-heading";
import { prisma } from "@/lib/db";
import { parseQuizJson } from "@/lib/homework-quiz";
import { requireTeacher } from "@/lib/session";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function TeacherHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const sp = await searchParams;
  const teacher = await requireTeacher();
  const [t, common, studentT] = await Promise.all([
    getTranslations("teacherHistory"),
    getTranslations("common"),
    getTranslations("studentHistory"),
  ]);
  const timeZone = normalizeTimezone(teacher.timezone);
  const studentFilter = sp.student?.trim() || null;

  const [students, lessons] = await Promise.all([
    prisma.student.findMany({
      where: {
        teacherId: teacher.id,
        archivedAt: null,
        NOT: {
          email: { endsWith: "@calendar.ayanote.local" },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.lesson.findMany({
      where: {
        teacherId: teacher.id,
        status: "completed",
        ...(studentFilter ? { studentId: studentFilter } : {}),
      },
      include: {
        student: { select: { id: true, name: true } },
        summary: true,
        homeworks: true,
      },
      orderBy: { startsAt: "desc" },
      take: 100,
    }),
  ]);

  const selectedStudent = studentFilter
    ? students.find((s) => s.id === studentFilter)
    : null;

  return (
    <AppShell active="history" personName={teacher.name}>
      <PageHeading
        icon={History}
        title={t("title")}
        subtitle={
          <>
            {t("subtitle")}
            {selectedStudent ? ` · ${selectedStudent.name}` : ""} · {timeZone}
          </>
        }
      />

      {students.length > 0 ? (
        <div className="history-student-filter" role="navigation">
          <Link
            className={`chip${studentFilter ? "" : " done"}`}
            href="/history"
          >
            {t("allStudents")}
          </Link>
          {students.map((student) => (
            <Link
              key={student.id}
              className={`chip${studentFilter === student.id ? " done" : ""}`}
              href={`/history?student=${student.id}`}
            >
              {student.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="panel">
        {lessons.length === 0 ? (
          <EmptyState icon={History}>{common("noItems")}</EmptyState>
        ) : (
          lessons.map((lesson) => {
            const hw = lesson.homeworks[0];
            const qCount =
              hw?.kind === "quiz" ? parseQuizJson(hw.quizJson).length : 0;
            const isDone = hw?.status === "done" || hw?.status === "reviewed";
            return (
              <div className="list-row" key={lesson.id}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
                    {studentFilter ? "" : ` · ${lesson.student.name}`}
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
                          ? studentT("hwReviewed")
                          : hw.status === "done"
                            ? studentT("hwDone")
                            : studentT("hwAssigned")}
                      </span>
                      {isDone && hw.score != null && qCount > 0 ? (
                        <span
                          className="muted"
                          style={{ marginLeft: "0.5rem" }}
                        >
                          {studentT("score", {
                            score: hw.score,
                            total: qCount,
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
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
                    {studentT("viewClassroom")}
                  </a>
                  <Link className="btn ghost sm" href={`/lessons/${lesson.id}`}>
                    <UiIcon icon={BookOpen} size={14} />
                    {t("openRoom")}
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
