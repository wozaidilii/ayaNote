import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  Video,
  UiIcon,
} from "@/components/icons";
import { EmptyState, PageHeading, PanelTitle } from "@/components/ui-heading";
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
  const now = new Date();

  const [lessons, fallbackClass] = await Promise.all([
    prisma.lesson.findMany({
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
    }),
    // Prefer a startable lesson even outside the Today window.
    prisma.lesson.findFirst({
      where: {
        teacherId: teacher.id,
        status: { in: ["scheduled", "in_progress"] },
        endsAt: { gte: new Date(now.getTime() - 30 * 60_000) },
      },
      orderBy: { startsAt: "asc" },
      select: { id: true },
    }),
  ]);

  const nextClass =
    lessons.find(
      (l) =>
        l.status !== "completed" &&
        l.endsAt.getTime() >= now.getTime() - 30 * 60_000,
    ) ??
    lessons.find((l) => l.status !== "completed") ??
    fallbackClass ??
    null;

  return (
    <AppShell active="today" personName={teacher.name}>
      <PageHeading
        icon={LayoutDashboard}
        title={t("title")}
        subtitle={
          <>
            {t("subtitle")} · {timeZone}
          </>
        }
        actions={
          <>
            {nextClass ? (
              <Link className="btn" href={`/classroom/${nextClass.id}`}>
                <UiIcon icon={Video} size={15} />
                {t("startClass")}
              </Link>
            ) : (
              <button className="btn" type="button" disabled>
                <UiIcon icon={Video} size={15} />
                {t("startClass")}
              </button>
            )}
            <Link className="btn secondary" href="/calendar">
              <UiIcon icon={CalendarDays} size={15} />
              {nav("calendar")}
            </Link>
            <Link className="btn secondary" href="/students">
              <UiIcon icon={Users} size={15} />
              {nav("students")}
            </Link>
          </>
        }
      />

      {!nextClass && (
        <p className="muted" style={{ marginTop: "-0.75rem" }}>
          {t("startClassEmpty")}
        </p>
      )}

      <div className="panel">
        <PanelTitle
          icon={LayoutDashboard}
          trailing={<span className="chip">{lessons.length}</span>}
        >
          {t("title")}
        </PanelTitle>

        {lessons.length === 0 ? (
          <EmptyState icon={CalendarDays}>
            <p>{common("noItems")}</p>
            <Link className="btn secondary" href="/calendar?view=days">
              <UiIcon icon={CalendarDays} size={15} />
              {nav("calendar")}
            </Link>
          </EmptyState>
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
                    <UiIcon icon={Video} size={14} />
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
