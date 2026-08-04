import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import {
  formatInTz,
  normalizeTimezone,
  rollingDayWindowInTz,
} from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function TodayPage() {
  const teacher = await requireTeacher();
  const [t, common, nav] = await Promise.all([
    getTranslations("today"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const timeZone = normalizeTimezone(teacher.timezone);
  const { start, end } = rollingDayWindowInTz(timeZone, 2);

  const lessons = await prisma.lesson.findMany({
    where: {
      teacherId: teacher.id,
      startsAt: { gte: start, lt: end },
      status: { not: "cancelled" },
    },
    include: {
      student: {
        include: {
          progress: true,
          lessons: {
            where: { status: "completed" },
            include: { summary: true },
            orderBy: { startsAt: "desc" },
            take: 1,
          },
        },
      },
      prepDraft: true,
    },
    orderBy: { startsAt: "asc" },
  });

  return (
    <AppShell active="today" personName={teacher.name}>
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="h1">{t("title")}</h1>
          <p className="muted">
            {t("subtitle")} · {timeZone}
          </p>
        </div>
        <div className="page-header-actions">
          <Link className="btn secondary" href="/calendar">
            {nav("calendar")}
          </Link>
          <Link className="btn secondary" href="/students">
            {nav("students")}
          </Link>
        </div>
      </header>

      <div className="panel">
        <div className="panel-header">
          <h2>{t("title")}</h2>
          <span className="chip">{lessons.length}</span>
        </div>

        {lessons.length === 0 ? (
          <div className="empty-state">
            <p>{common("noItems")}</p>
            <Link className="btn secondary" href="/calendar?view=days">
              {nav("calendar")}
            </Link>
          </div>
        ) : (
          lessons.map((lesson) => {
            const last = lesson.student.lessons[0]?.summary;
            const focus =
              last?.nextFocus ||
              parseJsonArray(lesson.student.progress?.topicsCoveredJson)[0] ||
              "—";
            return (
              <div className="list-row" key={lesson.id}>
                <div className="list-row-main">
                  <div className="list-row-title">{lesson.student.name}</div>
                  <div className="list-row-meta">
                    {formatInTz(lesson.startsAt, "MMM d · HH:mm", timeZone)} ·{" "}
                    {lesson.student.level}
                  </div>
                  <div className="list-row-tags">
                    <span className="chip">
                      {t("context")}: {focus}
                    </span>
                    <span
                      className={`chip ${lesson.prepStatus === "ready" ? "done" : "soon"}`}
                    >
                      {t("prepStatus")}: {lesson.prepStatus}
                    </span>
                  </div>
                </div>
                <div className="list-row-actions">
                  <a
                    className="btn sm"
                    href={`/classroom/${lesson.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("openClassroom")}
                  </a>
                  <Link
                    className="btn secondary sm"
                    href={`/lessons/${lesson.id}`}
                  >
                    {common("openLesson")}
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
