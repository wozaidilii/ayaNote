import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_STUDENT_EMAIL } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentHomePage() {
  const t = await getTranslations("studentHome");
  const common = await getTranslations("common");
  const student = await prisma.student.findFirstOrThrow({
    where: { email: DEMO_STUDENT_EMAIL, archivedAt: null },
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
    <AppShell active="home">
      <h1 className="h1">{t("title")}</h1>
      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("next")}</h2>
          {next ? (
            <>
              <p style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {format(next.startsAt, "yyyy-MM-dd HH:mm")}
              </p>
              <p>
                <strong>{t("status")}:</strong> {next.status}
              </p>
              <p>
                <strong>{t("whatNext")}:</strong>{" "}
                {next.prepDraft?.newFocus || next.summary?.nextFocus || "—"}
              </p>
              {next.meetLink && (
                <p>
                  <a className="btn" href={next.meetLink} target="_blank" rel="noreferrer">
                    {t("joinMeet")}
                  </a>
                </p>
              )}
            </>
          ) : (
            <p className="muted">{common("noItems")}</p>
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
