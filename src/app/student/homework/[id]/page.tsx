import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { markHomeworkDone } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { HomeworkQuiz } from "@/components/homework-quiz";
import { BookOpen } from "@/components/icons";
import { PageHeading } from "@/components/ui-heading";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { parseAnswersJson, parseQuizJson } from "@/lib/homework-quiz";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";

export default async function StudentHomeworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const active = await getActiveStudent();
  const [t, hw] = await Promise.all([
    getTranslations("studentHomework"),
    prisma.homework.findUnique({
      where: { id },
      include: {
        lesson: { select: { startsAt: true, endsAt: true } },
        student: {
          select: {
            id: true,
            name: true,
            teacher: { select: { timezone: true } },
          },
        },
      },
    }),
  ]);

  if (!hw || hw.studentId !== active.id) notFound();

  const timeZone = normalizeTimezone(hw.student.teacher.timezone);
  const isSample = hw.source === "sample_level" || !hw.lesson;
  const lessonLabel = isSample
    ? hw.title || t("levelCheck")
    : formatInTz(hw.lesson!.startsAt, "yyyy-MM-dd HH:mm", timeZone);
  const questions = parseQuizJson(hw.quizJson);
  const answers = parseAnswersJson(hw.answersJson);
  const isDone = hw.status === "done" || hw.status === "reviewed";
  const isQuiz = hw.kind === "quiz" && questions.length > 0;
  const showSummary = isDone && (sp.ok === "done" || answers.length > 0);

  return (
    <AppShell active="homework" personName={hw.student.name}>
      <PageHeading
        icon={BookOpen}
        title={hw.title || t("title")}
        subtitle={
          <>
            {lessonLabel}
            {sp.ok === "done" ? ` · ${t("submitted")}` : null}
          </>
        }
      />

      {hw.instructions && !showSummary ? (
        <p className="muted" style={{ marginBottom: "1rem" }}>
          {hw.instructions}
        </p>
      ) : null}

      {isQuiz ? (
        <div className="panel homework-quiz-panel">
          <HomeworkQuiz
            homeworkId={hw.id}
            lessonLabel={lessonLabel}
            questions={questions}
            readOnly={isDone}
            initialAnswers={answers}
            score={hw.score}
            showSummary={showSummary}
            labels={{
              next: t("next"),
              submit: t("submit"),
              submitting: t("submitting"),
              progress: t("progress"),
              score: t("score"),
              reviewTitle: t("reviewTitle"),
              summaryTitle: t("summaryTitle"),
              summaryCorrect: t("summaryCorrect"),
              summaryWrong: t("summaryWrong"),
              reviewAnswers: t("reviewAnswers"),
              retry: t("retry"),
              backHome: t("backHome"),
              yourAnswer: t("yourAnswer"),
              correctAnswer: t("correctAnswer"),
            }}
          />
        </div>
      ) : (
        <div className="panel">
          <p>{hw.instructions || "—"}</p>
          {!isDone ? (
            <form action={markHomeworkDone} style={{ marginTop: "1rem" }}>
              <input type="hidden" name="homeworkId" value={hw.id} />
              <button className="btn" type="submit">
                {t("markDone")}
              </button>
            </form>
          ) : (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              {t("alreadyDone")}
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}
