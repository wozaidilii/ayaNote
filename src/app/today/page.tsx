import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { BookingInbox } from "@/components/booking-inbox";
import {
  CalendarDays,
  LayoutDashboard,
  NotebookPen,
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

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const teacher = await requireTeacher();
  const [t, common, nav] = await Promise.all([
    getTranslations("today"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const timeZone = normalizeTimezone(teacher.timezone);
  const { start, end } = rollingDayWindowInTz(timeZone, 2);

  const [lessons, pendingBookings] = await Promise.all([
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
    prisma.bookingRequest.findMany({
      where: { teacherId: teacher.id, status: "pending" },
      include: { student: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

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

      {sp.err === "booking_conflict" && <p className="chip">{t("bookingConflict")}</p>}
      {sp.ok?.startsWith("booking_") && <p className="chip done">{t("bookingUpdated")}</p>}

      {pendingBookings.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <BookingInbox
            returnTo="/today"
            timeZone={timeZone}
            bookings={pendingBookings.map((b) => ({
              id: b.id,
              type: b.type,
              note: b.note,
              studentName: b.student.name,
              requestedStart: b.requestedStart,
            }))}
            labels={{
              title: t("pendingBookings"),
              empty: common("noItems"),
              approve: common("approve"),
              decline: common("decline"),
            }}
          />
        </div>
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
                    {lesson.student.level} · {lesson.status}
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
                  <Link className="btn secondary sm" href={`/prep?lesson=${lesson.id}`}>
                    <UiIcon icon={NotebookPen} size={14} />
                    {t("openPrep")}
                  </Link>
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
