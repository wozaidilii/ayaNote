import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { PrepWorkspace, type PrepLessonItem } from "@/components/prep-workspace";
import { courseTypeLabel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";

export const maxDuration = 60;

export default async function PrepPage({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string }>;
}) {
  const sp = await searchParams;
  const [t, common, teacher] = await Promise.all([
    getTranslations("prep"),
    getTranslations("common"),
    prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } }),
  ]);
  const timeZone = normalizeTimezone(teacher.timezone);

  const upcoming = await prisma.lesson.findMany({
    where: {
      teacherId: teacher.id,
      status: "scheduled",
      startsAt: { gte: new Date(Date.now() - 86400000) },
    },
    include: {
      student: {
        include: {
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

  // One next lesson per student (earliest upcoming)
  const seen = new Set<string>();
  const nextByStudent = upcoming.filter((lesson) => {
    if (seen.has(lesson.studentId)) return false;
    seen.add(lesson.studentId);
    return true;
  });

  // Prefer deep-linked lesson even if not "next" for that student
  let queue = nextByStudent;
  if (sp.lesson && !queue.some((l) => l.id === sp.lesson)) {
    const linked = upcoming.find((l) => l.id === sp.lesson);
    if (linked) queue = [linked, ...queue.filter((l) => l.studentId !== linked.studentId)];
  }

  const items: PrepLessonItem[] = queue.map((lesson) => ({
    id: lesson.id,
    studentId: lesson.studentId,
    studentName: lesson.student.name,
    courseLabel: courseTypeLabel(lesson.student.courseType),
    level: lesson.student.level,
    startsAtLabel: formatInTz(lesson.startsAt, "EEE · MMM d HH:mm", timeZone),
    prepStatus: lesson.prepStatus,
    lastFocus: lesson.student.lessons[0]?.summary?.nextFocus ?? "",
    draft: {
      warmup: lesson.prepDraft?.warmup ?? "",
      review: lesson.prepDraft?.review ?? "",
      newFocus: lesson.prepDraft?.newFocus ?? "",
      practice: lesson.prepDraft?.practice ?? "",
      homeworkSeed: lesson.prepDraft?.homeworkSeed ?? "",
    },
  }));

  // Put requested lesson first in client selection via URL; component reads ?lesson=
  if (sp.lesson && items.length > 1) {
    items.sort((a, b) => (a.id === sp.lesson ? -1 : b.id === sp.lesson ? 1 : 0));
  }

  return (
    <AppShell active="prep">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="h1">{t("title")}</h1>
          <p className="muted">{t("subtitle")}</p>
        </div>
      </header>

      <PrepWorkspace
        lessons={items}
        labels={{
          queue: t("queue"),
          empty: t("empty"),
          regenerate: t("regenerate"),
          markReady: t("markReady"),
          saveDraft: `${common("save")} ${common("draft")}`,
          sectionWarmup: t("sectionWarmup"),
          sectionReview: t("sectionReview"),
          sectionNewFocus: t("sectionNewFocus"),
          sectionPractice: t("sectionPractice"),
          sectionHomework: t("sectionHomework"),
          lastFocus: t("lastFocus"),
          noDraft: t("noDraft"),
          sections: t("sections"),
          generating: t("generating"),
          generateMissing: t("generateMissing"),
          generateDone: t("generateDone"),
        }}
      />
    </AppShell>
  );
}
