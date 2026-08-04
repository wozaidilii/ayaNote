import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { StudentSwitcher } from "@/components/student-switcher";
import {
  getActiveStudent,
  listActiveStudentsForTeacher,
} from "@/lib/active-student";
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
        orderBy: { updatedAt: "desc" },
        take: 12,
      },
      lessons: {
        where: { status: { in: ["scheduled", "in_progress"] }, startsAt: { gte: new Date() } },
        include: { summary: true },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
    },
  });

  const lastCompleted = await prisma.lesson.findFirst({
    where: {
      studentId: student.id,
      status: "completed",
      summary: { is: { approved: true } },
    },
    include: { summary: true },
    orderBy: { startsAt: "desc" },
  });

  const next = student.lessons[0];
  const timeZone = normalizeTimezone(student.teacher.timezone);
  const pending = student.bookingRequests.filter((b) => b.status === "pending");
  const notices = selectBookingNotices(
    student.bookingRequests.map((b) => ({
      id: b.id,
      type: b.type,
      status: b.status as "approved" | "declined" | "cancelled" | "pending",
      requestedStart: b.requestedStart,
      updatedAt: b.updatedAt,
      note: b.note,
    })),
  );

  const homework = lastCompleted?.summary?.homework || "—";
  const whatNext = lastCompleted?.summary?.nextFocus || "—";

  return (
    <AppShell active="home" personName={student.name}>
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {student.name} · {student.email} · {timeZone}
      </p>

      {notices.length > 0 && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>{t("notices")}</h2>
          {notices.map((n) => (
            <p key={n.id} className="muted" style={{ margin: "0.35rem 0" }}>
              <span className={`chip ${n.status === "approved" ? "done" : ""}`}>{n.status}</span>{" "}
              {n.type} · {formatInTz(n.requestedStart, "MMM d HH:mm", timeZone)}
              {n.note ? ` — ${n.note}` : ""}
            </p>
          ))}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("next")}</h2>
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
                <strong>{t("whatNext")}:</strong> {whatNext}
              </p>
              {next.meetLink ? (
                <p>
                  <a
                    className="btn"
                    href={next.meetLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("joinMeet")}
                  </a>
                </p>
              ) : (
                <p className="muted">{t("noMeetYet")}</p>
              )}
              <p>
                <a
                  className="btn secondary"
                  href={`/classroom/${next.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("enterClassroom")}
                </a>
              </p>
            </>
          ) : (
            <p className="muted">{t("noUpcoming")}</p>
          )}
          <p style={{ marginTop: "1rem" }}>
            <strong>{common("homework")}:</strong> {homework}
          </p>
          <p style={{ marginTop: "0.8rem" }}>
            <Link className="btn secondary sm" href="/student/book">
              {t("bookCta")}
            </Link>
          </p>
          {pending.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3>{t("pending")}</h3>
              {pending.map((b) => (
                <p key={b.id} className="muted" style={{ margin: "0.3rem 0" }}>
                  {formatInTz(b.requestedStart, "MMM d HH:mm", timeZone)} ·{" "}
                  {b.status}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("progress")}</h2>
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
            <strong>{common("strengths")}:</strong>{" "}
            {parseJsonArray(student.progress?.strengthsJson).join(" · ") || "—"}
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
