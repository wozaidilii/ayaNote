import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { StudentsWorkspace } from "@/components/students-workspace";
import { prisma } from "@/lib/db";
import {
  isCalendarInboxEmail,
  isCalendarPlaceholderEmail,
} from "@/lib/calendar-sync";
import { requireTeacher } from "@/lib/session";
import { formatInTz, normalizeTimezone, ymdInTz } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const sp = await searchParams;
  const teacher = await requireTeacher();
  const [t, common] = await Promise.all([
    getTranslations("students"),
    getTranslations("common"),
  ]);

  const timeZone = normalizeTimezone(teacher.timezone);
  const loginUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "/";

  const [rows, levelRows] = await Promise.all([
    prisma.student.findMany({
      where: { teacherId: teacher.id },
      include: {
        progress: true,
        homeworks: {
          where: { status: "assigned" },
          select: { id: true },
        },
        lessons: {
          where: {
            status: { in: ["scheduled", "in_progress", "completed"] },
          },
          orderBy: { startsAt: "desc" },
          take: 20,
          select: {
            id: true,
            status: true,
            startsAt: true,
            prepDraft: { select: { id: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { teacherId: teacher.id },
      select: { level: true },
      distinct: ["level"],
    }),
  ]);

  const now = new Date();
  const students = rows
    .filter(
      (student) =>
        !isCalendarInboxEmail(student.email) &&
        !isCalendarPlaceholderEmail(student.email),
    )
    .map((student) => {
      const upcoming = student.lessons
        .filter((l) => l.status === "scheduled" && l.startsAt >= now)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
      return {
        id: student.id,
        name: student.name,
        email: student.email,
        level: student.level,
        courseType: student.courseType,
        goals: student.goals,
        privateNotes: student.privateNotes,
        recordingConsent: student.recordingConsent,
        hasPassword: Boolean(student.passwordHash),
        archivedAt: student.archivedAt?.toISOString() ?? null,
        attendanceCount: student.progress?.attendanceCount ?? 0,
        weaknesses: parseJsonArray(student.progress?.weaknessesJson),
        strengths: parseJsonArray(student.progress?.strengthsJson),
        topics: parseJsonArray(student.progress?.topicsCoveredJson),
        progressNote: student.progress?.note ?? "",
        startedAt: student.startedAt
          ? ymdInTz(student.startedAt, timeZone)
          : "",
        pricePerLesson:
          student.pricePerLesson != null ? String(student.pricePerLesson) : "",
        currency: student.currency || "JPY",
        lessonsPerWeek:
          student.lessonsPerWeek != null ? String(student.lessonsPerWeek) : "",
        priceNote: student.priceNote ?? "",
        hasUpcoming: Boolean(upcoming),
        nextLessonLabel: upcoming
          ? formatInTz(upcoming.startsAt, "MMM d HH:mm", timeZone)
          : "",
        nextLessonId: upcoming?.id ?? null,
        pendingHomework: student.homeworks.length,
        loginUrl,
      };
    });

  const levels = levelRows.map((l) => l.level).filter(Boolean);

  return (
    <AppShell active="students" personName={teacher.name}>
      <StudentsWorkspace
        students={students}
        levels={levels}
        initialStudentId={sp.student ?? null}
        labels={{
          title: t("title"),
          subtitle: t("subtitle"),
          addStudent: t("addStudent"),
          editStudent: t("editStudent"),
          name: t("name"),
          email: t("email"),
          account: t("account"),
          password: t("password"),
          passwordHint: t("passwordHint"),
          passwordNew: t("passwordNew"),
          passwordNewHint: t("passwordNewHint"),
          create: t("create"),
          save: common("save"),
          search: t("search"),
          searchPlaceholder: t("searchPlaceholder"),
          filterLevel: t("filterLevel"),
          allLevels: t("allLevels"),
          showArchived: t("showArchived"),
          archived: t("archived"),
          archive: t("archive"),
          restore: t("restore"),
          consent: t("consent"),
          close: t("close"),
          course: common("course"),
          level: common("level"),
          goals: common("goals"),
          attendance: common("attendance"),
          noItems: common("noItems"),
          loginCreds: t("loginCreds"),
          loginCredsHint: t("loginCredsHint"),
          loginUrl: t("loginUrl"),
          statusUpcoming: t("statusUpcoming"),
          statusHomework: t("statusHomework"),
          statusPassword: t("statusPassword"),
          statusConsent: t("statusConsent"),
          statusArchived: t("statusArchived"),
          noUpcoming: t("noUpcoming"),
          nextLesson: t("nextLesson"),
          openClassroom: t("openClassroom"),
          openPrep: t("openPrep"),
          openRoom: t("openRoom"),
          lessonHistory: t("lessonHistory"),
          progress: t("progress"),
          strengths: common("strengths"),
          weaknesses: common("weaknesses"),
          topics: common("topics"),
          privateNotes: t("privateNotes"),
          startedAt: t("startedAt"),
          pricePerLesson: t("pricePerLesson"),
          currency: t("currency"),
          lessonsPerWeek: t("lessonsPerWeek"),
          priceNote: t("priceNote"),
          details: t("details"),
        }}
      />
    </AppShell>
  );
}
