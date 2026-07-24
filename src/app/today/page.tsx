import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function TodayPage() {
  const t = await getTranslations("today");
  const common = await getTranslations("common");
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);

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
    <AppShell active="today">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <div className="panel" style={{ marginTop: "1.2rem" }}>
        {lessons.length === 0 && <p className="muted">{common("noItems")}</p>}
        {lessons.map((lesson) => {
          const last = lesson.student.lessons[0]?.summary;
          const focus =
            last?.nextFocus || parseJsonArray(lesson.student.progress?.topicsCoveredJson)[0] || "—";
          return (
            <div className="list-row" key={lesson.id}>
              <div>
                <div style={{ fontWeight: 700 }}>{lesson.student.name}</div>
                <div className="muted" style={{ fontSize: "0.9rem" }}>
                  {format(lesson.startsAt, "MMM d · HH:mm")} · {lesson.student.level}
                </div>
                <div style={{ marginTop: "0.35rem" }}>
                  <span className="chip">
                    {t("context")}: {focus}
                  </span>{" "}
                  <span className="chip">
                    {t("prepStatus")}: {lesson.prepStatus}
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.4rem" }}>
                {lesson.meetLink && (
                  <a className="btn" href={lesson.meetLink} target="_blank" rel="noreferrer">
                    {t("joinMeet")}
                  </a>
                )}
                <Link className="btn secondary" href={`/lessons/${lesson.id}`}>
                  {common("openLesson")}
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
