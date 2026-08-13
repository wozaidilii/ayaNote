"use client";

import { useState, useTransition } from "react";
import { submitHomeworkQuiz } from "@/app/actions";
import type { QuizAnswer, QuizQuestion } from "@/lib/homework-quiz";

type Props = {
  homeworkId: string;
  lessonLabel: string;
  questions: QuizQuestion[];
  readOnly?: boolean;
  initialAnswers?: QuizAnswer[];
  score?: number | null;
  labels: {
    next: string;
    submit: string;
    submitting: string;
    progress: string;
    score: string;
    reviewTitle: string;
  };
};

export function HomeworkQuiz({
  homeworkId,
  lessonLabel,
  questions,
  readOnly = false,
  initialAnswers = [],
  score = null,
  labels,
}: Props) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<(number | null)[]>(() => {
    const arr = questions.map(() => null as number | null);
    for (const a of initialAnswers) {
      const i = questions.findIndex((q) => q.id === a.questionId);
      if (i >= 0) arr[i] = a.choiceIndex;
    }
    return arr;
  });
  const [pending, startTransition] = useTransition();

  if (questions.length === 0) {
    return <p className="muted">—</p>;
  }

  const q = questions[index]!;
  const choice = selected[index];
  const isLast = index >= questions.length - 1;
  const canAdvance = choice !== null;

  function goNext() {
    if (!canAdvance) return;
    if (isLast) {
      if (readOnly) return;
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

      {readOnly && score != null ? (
        <p className="homework-quiz-score">
          {labels.score
            .replace("{score}", String(score))
            .replace("{total}", String(questions.length))}
          {readOnly ? ` · ${labels.reviewTitle}` : ""}
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
          const correct = readOnly && i === q.answerIndex ? " correct" : "";
          const wrong =
            readOnly && selectedHere && i !== q.answerIndex ? " wrong" : "";
          return (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={selectedHere}
              className={`homework-quiz-choice${selectedHere ? " selected" : ""}${correct}${wrong}`}
              disabled={readOnly || pending}
              onClick={() => {
                if (readOnly) return;
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

      {!readOnly ? (
        <div className="homework-quiz-actions">
          <button
            type="button"
            className="btn homework-quiz-cta"
            disabled={!canAdvance || pending}
            onClick={goNext}
          >
            {pending ? labels.submitting : isLast ? labels.submit : labels.next}
          </button>
        </div>
      ) : null}
    </div>
  );
}
