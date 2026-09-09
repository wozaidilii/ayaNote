import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import {
  BookOpen,
  CalendarPlus,
  Home,
  Video,
  UiIcon,
} from "@/components/icons";
import { PageHeading, PanelTitle } from "@/components/ui-heading";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { ensureLessonHomeworkFromSummaries } from "@/lib/materialize-homework";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentHomePage() {
  const [t, common, active] = await Promise.all([
    getTranslations("studentHome"),
    getTranslations("common"),
    getActiveStudent(),
  ]);
  await ensureLessonHomeworkFromSummaries(active.id);

  const student = await prisma.student.findFirstOrThrow({
    where: { id: active.id },
    include: {
      teacher: { select: { timezone: true } },
      progress: true,
      bookingRequests: {
        where: { status: "pending" },
        orderBy: { requestedStart: "asc" },
        take: 3,
      },
      lessons: {
        where: {
          status: { in: ["scheduled", "in_progress"] },
        },
        orderBy: { startsAt: "asc" },
        take: 12,
      },
      homeworks: {
        where: { status: "assigned" },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
  });

  const now = new Date();
  const graceMs = 30 * 60_000;
  const live = student.lessons.filter(
    (lesson) =>
      lesson.startsAt <= now &&
      lesson.endsAt.getTime() + graceMs >= now.getTime(),
  );
  const upcoming = student.lessons.filter((lesson) => lesson.startsAt > now);
  const featured = live[0] ?? upcoming[0] ?? null;
  const moreUpcoming = upcoming.filter((lesson) => lesson.id !== featured?.id);
  const timeZone = normalizeTimezone(student.teacher.timezone);
  const homeworkLine =
    student.homeworks[0]?.title || student.homeworks[0]?.instructions || "";
  const featuredIsLive = Boolean(
    featured && live.some((lesson) => lesson.id === featured.id),
  );

  return (
    <AppShell active="home" personName={student.name}>
      <PageHeading
        icon={Home}
        title={t("title")}
        subtitle={
          <>
            {student.name} · {student.email} · {timeZone}
          </>
        }
      />

      <div className="grid-2">
        <div className="panel">
          <PanelTitle icon={CalendarPlus}>
            {featuredIsLive ? t("now") : t("next")}
          </PanelTitle>
          {featured ? (
            <>
              <p style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {formatInTz(featured.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
                <span className="muted" style={{ fontWeight: 500 }}>
                  {" "}
                  – {formatInTz(featured.endsAt, "HH:mm", timeZone)}
                </span>
              </p>
              <p>
                <strong>{t("status")}:</strong> {featured.status}
              </p>
              <p>
                <strong>{t("whatNext")}:</strong> {homeworkLine || "—"}
              </p>
              {homeworkLine ? (
                <p>
                  <strong>{t("pendingHomework")}:</strong> {homeworkLine}{" "}
                  <a
                    className="btn secondary sm"
                    href={`/student/homework/${student.homeworks[0]!.id}`}
                  >
                    {t("doHomework")}
                  </a>
                </p>
              ) : null}
              <p>
                <a
                  className="btn"
                  href={`/classroom/${featured.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <UiIcon icon={Video} size={15} />
                  {t("enterClassroom")}
                </a>
              </p>
            </>
          ) : (
            <p className="muted">{t("noUpcoming")}</p>
          )}
          {moreUpcoming.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3>{t("upcoming")}</h3>
              {moreUpcoming.map((lesson) => (
                <p key={lesson.id} style={{ margin: "0.35rem 0" }}>
                  {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)} –{" "}
                  {formatInTz(lesson.endsAt, "HH:mm", timeZone)}
                </p>
              ))}
            </div>
          )}
          {student.bookingRequests.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3>{t("pending")}</h3>
              {student.bookingRequests.map((b) => (
                <p key={b.id} className="muted" style={{ margin: "0.3rem 0" }}>
                  {formatInTz(b.requestedStart, "MMM d HH:mm", timeZone)} ·{" "}
                  {b.status}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <PanelTitle icon={BookOpen}>{t("progress")}</PanelTitle>
          <p>
            <strong>{common("attendance")}:</strong>{" "}
            {student.progress?.attendanceCount ?? 0}
          </p>
          <p>
            <strong>{common("topics")}:</strong>{" "}
            {parseJsonArray(student.progress?.topicsCoveredJson).join(" · ") ||
              "—"}
          </p>
        </div>
      </div>
    </AppShell>
  );
}
