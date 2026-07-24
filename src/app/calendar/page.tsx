import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { decideBooking } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";

export default async function CalendarPage() {
  const t = await getTranslations("calendar");
  const common = await getTranslations("common");
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
  const now = new Date();

  const lessons = await prisma.lesson.findMany({
    where: {
      teacherId: teacher.id,
      status: { not: "cancelled" },
    },
    include: {
      student: true,
      summary: true,
      prepDraft: true,
    },
    orderBy: { startsAt: "asc" },
  });

  const pending = await prisma.bookingRequest.findMany({
    where: { teacherId: teacher.id, status: "pending" },
    include: { student: true },
    orderBy: { requestedStart: "asc" },
  });

  const upcoming = lessons.filter((l) => l.status !== "completed" && l.startsAt >= now);
  const past = lessons
    .filter((l) => l.status === "completed" || l.startsAt < now)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  const googleConnected = Boolean(teacher.googleConnectedEmail || teacher.googleRefreshToken);

  return (
    <AppShell active="calendar">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="panel" style={{ marginTop: "1.1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", flexWrap: "wrap" }}>
          <div>
            <span className="pixel-banner">
              {googleConnected ? t("connected") : t("notConnected")}
            </span>
            <p style={{ margin: "0.7rem 0 0" }}>{t("syncNote")}</p>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {!googleConnected && (
              <a className="btn" href="/api/google/connect">
                {t("connectGoogle")}
              </a>
            )}
            <a className="btn sky" href="https://calendar.google.com/" target="_blank" rel="noreferrer">
              {t("openGoogle")}
            </a>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("pending")}</h2>
          {pending.map((b) => (
            <div className="list-row" key={b.id}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {b.student.name} · {b.type}
                </div>
                <div className="muted">{format(b.requestedStart, "yyyy-MM-dd HH:mm")}</div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <form action={decideBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="btn" type="submit">
                    {common("approve")}
                  </button>
                </form>
                <form action={decideBooking}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="decision" value="decline" />
                  <button className="btn danger" type="submit">
                    {common("decline")}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("upcoming")}</h2>
        {upcoming.length === 0 && <p className="muted">{common("noItems")}</p>}
        {upcoming.map((lesson) => (
          <div className="list-row" key={lesson.id} id={`cal-${lesson.id}`}>
            <div>
              <div style={{ fontWeight: 800 }}>
                {format(lesson.startsAt, "yyyy-MM-dd HH:mm")} – {format(lesson.endsAt, "HH:mm")}
              </div>
              <div className="muted">
                {lesson.student.name} · {lesson.student.level}
              </div>
              <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                <span className="chip soon">{t("notStarted")}</span>
                <span className="chip">
                  {t("prep")}: {lesson.prepStatus}
                </span>
                {lesson.prepDraft?.newFocus && (
                  <span className="chip sky">{lesson.prepDraft.newFocus.slice(0, 42)}</span>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {lesson.meetLink && (
                <a className="btn" href={lesson.meetLink} target="_blank" rel="noreferrer">
                  {t("joinMeet")}
                </a>
              )}
              <Link className="btn secondary" href={`/prep#lesson-${lesson.id}`}>
                {t("openPrep")}
              </Link>
              <Link className="btn ghost" href={`/lessons/${lesson.id}`}>
                {common("openLesson")}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("past")}</h2>
        {past.length === 0 && <p className="muted">{common("noItems")}</p>}
        {past.map((lesson) => (
          <div className="list-row" key={lesson.id}>
            <div>
              <div style={{ fontWeight: 800 }}>
                {format(lesson.startsAt, "yyyy-MM-dd HH:mm")} – {format(lesson.endsAt, "HH:mm")}
              </div>
              <div className="muted">
                {lesson.student.name} · {lesson.summary?.nextFocus || lesson.status}
              </div>
              <div style={{ marginTop: "0.35rem" }}>
                <span className="chip done">{t("finished")}</span>
              </div>
            </div>
            <Link className="btn" href={`/lessons/${lesson.id}`}>
              {t("openRecord")}
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
