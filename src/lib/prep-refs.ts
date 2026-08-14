export type VocabRecallItem = {
  blanked: string;
  /** Meaning/summary cue shown as （hint） beside the blank */
  hint: string;
  answer: string;
};

export type PrepRefs = {
  course: string;
  level: string;
  goals: string;
  pastLessons: string[];
  topics: string[];
  weaknesses: string[];
  vocab: string[];
  /** Cloze sentences: ＿＿(hint), hover blank for answer — this lesson */
  vocabRecall: VocabRecallItem[];
  /** Cloze generated with this prep; belongs on the following lesson */
  nextVocabRecall: VocabRecallItem[];
};

export const emptyPrepRefs = (): PrepRefs => ({
  course: "",
  level: "",
  goals: "",
  pastLessons: [],
  topics: [],
  weaknesses: [],
  vocab: [],
  vocabRecall: [],
  nextVocabRecall: [],
});

function parseVocabRecall(value: unknown): VocabRecallItem[] {
  if (!Array.isArray(value)) return [];
  const items: VocabRecallItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as {
      blanked?: unknown;
      hint?: unknown;
      answer?: unknown;
    };
    const blanked = String(row.blanked ?? "").trim();
    const answer = String(row.answer ?? "").trim();
    if (!blanked || !answer) continue;
    const hint = String(row.hint ?? "").trim() || answer;
    items.push({ blanked, hint, answer });
  }
  return items.slice(0, 8);
}

export function parsePrepRefs(value: string | null | undefined): PrepRefs {
  if (!value) return emptyPrepRefs();
  try {
    const parsed = JSON.parse(value) as Partial<PrepRefs>;
    return {
      course: String(parsed.course ?? ""),
      level: String(parsed.level ?? ""),
      goals: String(parsed.goals ?? ""),
      pastLessons: Array.isArray(parsed.pastLessons)
        ? parsed.pastLessons.map(String)
        : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      weaknesses: Array.isArray(parsed.weaknesses)
        ? parsed.weaknesses.map(String)
        : [],
      vocab: Array.isArray(parsed.vocab) ? parsed.vocab.map(String) : [],
      vocabRecall: parseVocabRecall(parsed.vocabRecall),
      nextVocabRecall: parseVocabRecall(parsed.nextVocabRecall),
    };
  } catch {
    return emptyPrepRefs();
  }
}

export function hasPrepRefs(refs: PrepRefs) {
  return Boolean(
    refs.course ||
    refs.level ||
    refs.goals ||
    refs.pastLessons.length ||
    refs.topics.length ||
    refs.weaknesses.length ||
    refs.vocab.length ||
    refs.vocabRecall.length ||
    refs.nextVocabRecall.length,
  );
}
