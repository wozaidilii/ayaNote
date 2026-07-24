import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { StudentSwitcher } from "@/components/student-switcher";
import { getActiveStudent, listActiveStudentsForTeacher } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentHomePage() {
  const [t, common, active, roster] = await Promise.all([
    getTranslations("studentHome"),
    getTranslations("common"),
    getActiveStudent(),
    listActiveStudentsForTeacher(),
  ]);

  const student = await prisma.student.findFirstOrThrow({
    where: { id: active.id },
    include: {
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

  return (
    <AppShell active="home" personName={student.name}>
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {student.name} · {student.email}
      </p>

      <StudentSwitcher
        activeId={student.id}
        label={t("switchStudent")}
        students={roster.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          nextLabel: s.lessons[0] ? format(s.lessons[0].startsAt, "MMM d HH:mm") : undefined,
        }))}
      />

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("next")}</h2>
          {next ? (
            <>
              <p style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {format(next.startsAt, "yyyy-MM-dd HH:mm")}
                <span className="muted" style={{ fontWeight: 500 }}>
                  {" "}
                  – {format(next.endsAt, "HH:mm")}
                </span>
              </p>
              <p>
                <strong>{t("status")}:</strong> {next.status}
              </p>
              <p>
                <strong>{t("whatNext")}:</strong>{" "}
                {next.prepDraft?.newFocus || next.summary?.nextFocus || "—"}
              </p>
              {next.meetLink ? (
                <p>
                  <a className="btn" href={next.meetLink} target="_blank" rel="noreferrer">
                    {t("joinMeet")}
                  </a>
                </p>
              ) : (
                <p className="muted">{t("noMeetYet")}</p>
              )}
            </>
          ) : (
            <p className="muted">{t("noUpcoming")}</p>
          )}
          {student.bookingRequests.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3>{t("pending")}</h3>
              {student.bookingRequests.map((b) => (
                <p key={b.id} className="muted" style={{ margin: "0.3rem 0" }}>
                  {format(b.requestedStart, "MMM d HH:mm")} · {b.status}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("progress")}</h2>
          <p>
            <strong>{common("attendance")}:</strong> {student.progress?.attendanceCount ?? 0}
          </p>
          <p>
            <strong>{common("topics")}:</strong>{" "}
            {parseJsonArray(student.progress?.topicsCoveredJson).join(" · ") || "—"}
          </p>
          <p className="muted">{student.progress?.note}</p>
        </div>
      </div>
    </AppShell>
  );
}
