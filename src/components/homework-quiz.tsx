"use client";

import { useMemo, useState, useTransition } from "react";
import { retryHomeworkQuiz, submitHomeworkQuiz } from "@/app/actions";
import type { QuizAnswer, QuizQuestion } from "@/lib/homework-quiz";

type Labels = {
  next: string;
  submit: string;
  submitting: string;
  progress: string;
  score: string;
  reviewTitle: string;
  summaryTitle: string;
  summaryCorrect: string;
  summaryWrong: string;
  reviewAnswers: string;
  retry: string;
  backHome: string;
  yourAnswer: string;
  correctAnswer: string;
};

type Props = {
  homeworkId: string;
  lessonLabel: string;
  questions: QuizQuestion[];
  readOnly?: boolean;
  initialAnswers?: QuizAnswer[];
  score?: number | null;
  showSummary?: boolean;
  labels: Labels;
};

export function HomeworkQuiz({
  homeworkId,
  lessonLabel,
  questions,
  readOnly = false,
  initialAnswers = [],
  score = null,
  showSummary = false,
  labels,
}: Props) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"quiz" | "summary" | "review">(
    showSummary || (readOnly && score != null)
      ? "summary"
      : readOnly
        ? "review"
        : "quiz",
  );
  const [selected, setSelected] = useState<(number | null)[]>(() => {
    const arr = questions.map(() => null as number | null);
    for (const a of initialAnswers) {
      const i = questions.findIndex((q) => q.id === a.questionId);
      if (i >= 0) arr[i] = a.choiceIndex;
    }
    return arr;
  });
  const [pending, startTransition] = useTransition();

  const results = useMemo(() => {
    return questions.map((q, i) => {
      const choice = selected[i];
      const correct = choice === q.answerIndex;
      return { q, choice, correct };
    });
  }, [questions, selected]);

  const computedScore = useMemo(
    () => results.filter((r) => r.correct).length,
    [results],
  );
  const displayScore = score ?? computedScore;

  if (questions.length === 0) {
    return <p className="muted">—</p>;
  }

  if (mode === "summary") {
    return (
      <div className="homework-quiz homework-quiz-summary">
        <div className="homework-quiz-top">
          <span className="homework-quiz-lesson">{lessonLabel}</span>
        </div>
        <h2 className="homework-quiz-summary-title">{labels.summaryTitle}</h2>
        <p className="homework-quiz-score homework-quiz-score-lg">
          {labels.score
            .replace("{score}", String(displayScore))
            .replace("{total}", String(questions.length))}
        </p>
        <ul className="homework-quiz-summary-list">
          {results.map((r, i) => (
            <li
              key={r.q.id}
              className={`homework-quiz-summary-item${r.correct ? " is-correct" : " is-wrong"}`}
            >
              <span className="homework-quiz-summary-num">{i + 1}</span>
              <div>
                <div className="homework-quiz-summary-stem">
                  <span className="homework-quiz-target">{r.q.target}</span>
                  <span className="muted"> · {r.q.type}</span>
                </div>
                <div className="muted" style={{ fontSize: "0.9rem" }}>
                  {r.correct ? labels.summaryCorrect : labels.summaryWrong}
                  {r.choice != null && !r.correct ? (
                    <>
                      {" · "}
                      {labels.yourAnswer}: {r.q.choices[r.choice] ?? "—"}
                      {" · "}
                      {labels.correctAnswer}: {r.q.choices[r.q.answerIndex]}
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="homework-quiz-actions homework-quiz-summary-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setMode("review");
              setIndex(0);
            }}
          >
            {labels.reviewAnswers}
          </button>
          <form action={retryHomeworkQuiz}>
            <input type="hidden" name="homeworkId" value={homeworkId} />
            <button className="btn" type="submit">
              {labels.retry}
            </button>
          </form>
          <a className="btn ghost" href="/student/homework">
            {labels.backHome}
          </a>
        </div>
      </div>
    );
  }

  const inReview = mode === "review" || readOnly;
  const q = questions[index]!;
  const choice = selected[index];
  const isLast = index >= questions.length - 1;
  const canAdvance = choice !== null;

  function goNext() {
    if (!canAdvance) return;
    if (isLast) {
      if (inReview) {
        setMode("summary");
        return;
      }
      const answers: QuizAnswer[] = questions.map((question, i) => ({
        questionId: question.id,
        choiceIndex: selected[i] ?? -1,
      }));
      if (answers.some((a) => a.choiceIndex < 0)) return;
      const fd = new FormData();
      fd.set("homeworkId", homeworkId);
      fd.set("answersJson", JSON.stringify(answers));
      startTransition(() => {
        void submitHomeworkQuiz(fd);
      });
      return;
    }
    setIndex((i) => Math.min(i + 1, questions.length - 1));
  }

  return (
    <div className="homework-quiz">
      <div className="homework-quiz-top">
        <span className="homework-quiz-lesson">{lessonLabel}</span>
        <span className="homework-quiz-progress-label">
          {labels.progress
            .replace("{current}", String(index + 1))
            .replace("{total}", String(questions.length))}
        </span>
      </div>

      <ol className="homework-quiz-dots" aria-label={labels.progress}>
        {questions.map((_, i) => (
          <li key={i}>
            <button
              type="button"
              className={`homework-quiz-dot${i === index ? " active" : ""}${
                selected[i] !== null ? " answered" : ""
              }`}
              onClick={() => setIndex(i)}
              aria-current={i === index ? "step" : undefined}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>

      {inReview && displayScore != null ? (
        <p className="homework-quiz-score">
          {labels.score
            .replace("{score}", String(displayScore))
            .replace("{total}", String(questions.length))}
          {" · "}
          {labels.reviewTitle}
          {" · "}
          <button
            type="button"
            className="linkish"
            onClick={() => setMode("summary")}
          >
            {labels.summaryTitle}
          </button>
        </p>
      ) : null}

      <p className="homework-quiz-prompt">{q.prompt}</p>

      <p className="homework-quiz-stem">
        {q.stem.includes(q.target) ? (
          <>
            {q.stem.split(q.target).map((part, i, parts) => (
              <span key={i}>
                {part}
                {i < parts.length - 1 ? (
                  <span className="homework-quiz-target">{q.target}</span>
                ) : null}
              </span>
            ))}
          </>
        ) : (
          <>
            <span className="homework-quiz-target">{q.target}</span>
            <span className="muted"> — {q.stem}</span>
          </>
        )}
      </p>

      <div
        className="homework-quiz-choices"
        role="listbox"
        aria-label="choices"
      >
        {q.choices.map((text, i) => {
          const selectedHere = choice === i;
          const correct = inReview && i === q.answerIndex ? " correct" : "";
          const wrong =
            inReview && selectedHere && i !== q.answerIndex ? " wrong" : "";
          return (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={selectedHere}
              className={`homework-quiz-choice${selectedHere ? " selected" : ""}${correct}${wrong}`}
              disabled={inReview || pending}
              onClick={() => {
                if (inReview) return;
                setSelected((prev) => {
                  const next = [...prev];
                  next[index] = i;
                  return next;
                });
              }}
            >
              <span className="homework-quiz-choice-num">{i + 1}</span>
              <span className="homework-quiz-choice-text">{text}</span>
            </button>
          );
        })}
      </div>

      <div className="homework-quiz-actions">
        {inReview ? (
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              ←
            </button>
            <button
              type="button"
              className="btn homework-quiz-cta"
              onClick={() => {
                if (isLast) setMode("summary");
                else setIndex((i) => i + 1);
              }}
            >
              {isLast ? labels.summaryTitle : labels.next}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn homework-quiz-cta"
            disabled={!canAdvance || pending}
            onClick={goNext}
          >
            {pending ? labels.submitting : isLast ? labels.submit : labels.next}
          </button>
        )}
      </div>
    </div>
  );
}
