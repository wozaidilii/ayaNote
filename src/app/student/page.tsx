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
import { formatInTz, normalizeTimezone } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentHomePage() {
  const [t, common, active] = await Promise.all([
    getTranslations("studentHome"),
    getTranslations("common"),
    getActiveStudent(),
  ]);

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
        where: { status: "scheduled", startsAt: { gte: new Date() } },
        include: { prepDraft: true, summary: true },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
    },
  });

  const next = student.lessons[0];
  const timeZone = normalizeTimezone(student.teacher.timezone);

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
          <PanelTitle icon={CalendarPlus}>{t("next")}</PanelTitle>
          {next ? (
            <>
              <p style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {formatInTz(next.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
                <span className="muted" style={{ fontWeight: 500 }}>
                  {" "}
                  – {formatInTz(next.endsAt, "HH:mm", timeZone)}
                </span>
              </p>
              <p>
                <strong>{t("status")}:</strong> {next.status}
              </p>
              <p>
                <strong>{t("whatNext")}:</strong>{" "}
                {next.prepDraft?.newFocus || next.summary?.nextFocus || "—"}
              </p>
              <p>
                <a
                  className="btn"
                  href={`/classroom/${next.id}`}
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
          <p>
            <strong>{common("weaknesses")}:</strong>{" "}
            {parseJsonArray(student.progress?.weaknessesJson).join(" · ") ||
              "—"}
          </p>
        </div>
      </div>
    </AppShell>
  );
}
