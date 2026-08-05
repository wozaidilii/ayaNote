import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BookOpen } from "@/components/icons";
import { SummaryGeneratingPanel } from "@/components/summary-generating-panel";
import { PageHeading } from "@/components/ui-heading";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

type VocabRow = { term: string; reading?: string; meaning?: string };
type GrammarRow = { pattern: string; notes?: string };

function parseObjectArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export default async function StudentLessonSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const active = await getActiveStudent();
  const [t, common, lessonRoom] = await Promise.all([
    getTranslations("studentLesson"),
    getTranslations("common"),
    getTranslations("lessonRoom"),
  ]);

  const lesson = await prisma.lesson.findUnique({
    where: { id },
    include: {
      teacher: { select: { id: true, name: true, timezone: true } },
      student: { select: { id: true, name: true } },
      summary: true,
      transcript: true,
    },
  });
  if (!lesson) notFound();
  if (lesson.teacherId !== active.teacherId) redirect("/student");

  const timeZone = normalizeTimezone(lesson.teacher.timezone);
  const summarizing = sp.ok === "summarizing" && !lesson.summary;
  const topics = lesson.summary
    ? parseJsonArray(lesson.summary.topicsJson)
    : [];
  const vocab = lesson.summary
    ? parseObjectArray<VocabRow>(lesson.summary.vocabJson)
    : [];
  const grammar = lesson.summary
    ? parseObjectArray<GrammarRow>(lesson.summary.grammarJson)
    : [];

  return (
    <AppShell active="history" personName={active.name}>
      <PageHeading
        icon={BookOpen}
        title={t("title")}
        subtitle={
          <>
            {lesson.teacher.name} ·{" "}
            {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
          </>
        }
      />

      {sp.ok === "summary" && (
        <p className="chip done" style={{ marginBottom: "0.75rem" }}>
          {t("okSummary")}
        </p>
      )}
      {summarizing && (
        <p className="chip soon" style={{ marginBottom: "0.75rem" }}>
          {lessonRoom("summarizingChip")}
        </p>
      )}

      {summarizing ? (
        <SummaryGeneratingPanel
          lessonId={lesson.id}
          readyHref={`/student/lessons/${lesson.id}?ok=summary`}
          labels={{
            generatingTitle: lessonRoom("generatingTitle"),
            generatingBody: t("generatingBody"),
            generatingFailed: lessonRoom("generatingFailed"),
          }}
        />
      ) : lesson.summary ? (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("todayContent")}</h2>
          <p>{lesson.summary.todaySummary}</p>
          <h3>{common("topics")}</h3>
          <p className="muted">{topics.join(" · ") || "—"}</p>
          <h3>{common("homework")}</h3>
          <p>{lesson.summary.homework || "—"}</p>
          <h3>{common("nextFocus")}</h3>
          <p>{lesson.summary.nextFocus || "—"}</p>
          {vocab.length > 0 && (
            <>
              <h3>{common("vocab")}</h3>
              <ul>
                {vocab.map((v) => (
                  <li key={v.term}>
                    {v.term}
                    {v.reading ? ` (${v.reading})` : ""}
                    {v.meaning ? ` — ${v.meaning}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          {grammar.length > 0 && (
            <>
              <h3>{common("grammar")}</h3>
              <ul>
                {grammar.map((g) => (
                  <li key={g.pattern}>
                    {g.pattern}
                    {g.notes ? ` — ${g.notes}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="panel">
          <p className="muted">{t("waiting")}</p>
        </div>
      )}
    </AppShell>
  );
}
