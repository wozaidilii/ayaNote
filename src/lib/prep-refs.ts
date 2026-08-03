export type PrepRefs = {
  course: string;
  level: string;
  goals: string;
  pastLessons: string[];
  topics: string[];
  weaknesses: string[];
  vocab: string[];
};

export const emptyPrepRefs = (): PrepRefs => ({
  course: "",
  level: "",
  goals: "",
  pastLessons: [],
  topics: [],
  weaknesses: [],
  vocab: [],
});

export function parsePrepRefs(value: string | null | undefined): PrepRefs {
  if (!value) return emptyPrepRefs();
  try {
    const parsed = JSON.parse(value) as Partial<PrepRefs>;
    return {
      course: String(parsed.course ?? ""),
      level: String(parsed.level ?? ""),
      goals: String(parsed.goals ?? ""),
      pastLessons: Array.isArray(parsed.pastLessons) ? parsed.pastLessons.map(String) : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String) : [],
      vocab: Array.isArray(parsed.vocab) ? parsed.vocab.map(String) : [],
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
      refs.vocab.length,
  );
}
