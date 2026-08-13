import { toJson } from "@/lib/utils";

export type VocabForQuiz = {
  term: string;
  reading?: string;
  meaning?: string;
};

export type QuizQuestion = {
  id: string;
  type: "reading" | "meaning";
  prompt: string;
  stem: string;
  target: string;
  choices: string[];
  answerIndex: number;
};

export type QuizAnswer = {
  questionId: string;
  choiceIndex: number;
};

const HAS_KANJI = /[\u4e00-\u9faf]/;
const MAX_QUESTIONS = 12;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function uniqueNonEmpty(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Simple distractors when the lesson bank is thin. */
function fakeReadings(correct: string): string[] {
  const base = correct.replace(/[っッ]/g, "");
  const swaps = [
    base.replace(/ん/g, "む") || `${correct}ん`,
    base.replace(/う/g, "お") || `${correct}う`,
    `${correct.charAt(0) || "あ"}がって`,
    correct.length > 2 ? correct.slice(0, -1) + "る" : `${correct}る`,
  ];
  return uniqueNonEmpty(swaps.filter((s) => s !== correct));
}

function fakeMeanings(correct: string): string[] {
  return uniqueNonEmpty([
    `${correct} (related)`,
    "everyday expression",
    "formal greeting",
    "time expression",
  ]).filter((s) => s !== correct);
}

function pickDistractors(
  correct: string,
  pool: string[],
  fallback: string[],
  need = 3,
) {
  const fromPool = shuffle(pool.filter((p) => p && p !== correct));
  const merged = uniqueNonEmpty([...fromPool, ...fallback]).filter(
    (p) => p !== correct,
  );
  while (merged.length < need) {
    merged.push(`${correct}${merged.length + 1}`);
  }
  return merged.slice(0, need);
}

function buildChoices(correct: string, distractors: string[]) {
  const choices = shuffle([correct, ...distractors.slice(0, 3)]);
  return {
    choices,
    answerIndex: choices.indexOf(correct),
  };
}

/**
 * Build JLPT-style MCQ items from lesson vocab.
 * Returns [] if fewer than 3 usable vocab items.
 */
export function buildQuizFromVocab(vocab: VocabForQuiz[]): QuizQuestion[] {
  const usable = vocab
    .map((v) => ({
      term: (v.term ?? "").trim(),
      reading: (v.reading ?? "").trim(),
      meaning: (v.meaning ?? "").trim(),
    }))
    .filter((v) => v.term.length > 0);

  if (usable.length < 3) return [];

  const readingPool = uniqueNonEmpty(
    usable.map((v) => v.reading).filter(Boolean),
  );
  const meaningPool = uniqueNonEmpty(
    usable.map((v) => v.meaning).filter(Boolean),
  );

  const questions: QuizQuestion[] = [];
  let seq = 0;

  for (const item of usable) {
    if (questions.length >= MAX_QUESTIONS) break;

    if (HAS_KANJI.test(item.term) && item.reading) {
      const distractors = pickDistractors(
        item.reading,
        readingPool,
        fakeReadings(item.reading),
      );
      const { choices, answerIndex } = buildChoices(item.reading, distractors);
      seq += 1;
      questions.push({
        id: `q${seq}-reading`,
        type: "reading",
        prompt:
          "——の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。",
        stem: `「${item.term}」の読み方`,
        target: item.term,
        choices,
        answerIndex,
      });
    }

    if (questions.length >= MAX_QUESTIONS) break;

    if (item.meaning) {
      const distractors = pickDistractors(
        item.meaning,
        meaningPool,
        fakeMeanings(item.meaning),
      );
      const { choices, answerIndex } = buildChoices(item.meaning, distractors);
      seq += 1;
      questions.push({
        id: `q${seq}-meaning`,
        type: "meaning",
        prompt:
          "——の言葉の意味として最もよいものを、1・2・3・4から一つ選びなさい。",
        stem: `「${item.term}」の意味`,
        target: item.term,
        choices,
        answerIndex,
      });
    }
  }

  return questions.slice(0, MAX_QUESTIONS);
}

export function parseQuizJson(raw: string | null | undefined): QuizQuestion[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as QuizQuestion[]) : [];
  } catch {
    return [];
  }
}

export function parseAnswersJson(raw: string | null | undefined): QuizAnswer[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as QuizAnswer[]) : [];
  } catch {
    return [];
  }
}

export function scoreQuiz(
  questions: QuizQuestion[],
  answers: QuizAnswer[],
): number {
  const byId = new Map(answers.map((a) => [a.questionId, a.choiceIndex]));
  let correct = 0;
  for (const q of questions) {
    if (byId.get(q.id) === q.answerIndex) correct += 1;
  }
  return correct;
}

export function serializeQuiz(questions: QuizQuestion[]) {
  return toJson(questions);
}

export function serializeAnswers(answers: QuizAnswer[]) {
  return toJson(answers);
}
