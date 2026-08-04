export type PrepGenerationSource = "ai" | "heuristic" | "edited" | "unknown";

export type PastLessonRef = {
  id: string;
  label: string;
};

export type PrepRefs = {
  course: string;
  level: string;
  goals: string;
  pastLessons: string[];
  /** Clickable past lessons used when drafting (preferred over pastLessons labels alone). */
  pastLessonLinks: PastLessonRef[];
  topics: string[];
  weaknesses: string[];
  vocab: string[];
  generationSource: PrepGenerationSource;
};

export const emptyPrepRefs = (): PrepRefs => ({
  course: "",
  level: "",
  goals: "",
  pastLessons: [],
  pastLessonLinks: [],
  topics: [],
  weaknesses: [],
  vocab: [],
  generationSource: "unknown",
});

function parsePastLessonLinks(value: unknown): PastLessonRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { id?: unknown; label?: unknown };
      const id = String(row.id ?? "").trim();
      const label = String(row.label ?? "").trim();
      if (!id || !label) return null;
      return { id, label };
    })
    .filter((x): x is PastLessonRef => Boolean(x));
}

function parseGenerationSource(value: unknown): PrepGenerationSource {
  if (value === "ai" || value === "heuristic" || value === "edited" || value === "unknown") {
    return value;
  }
  return "unknown";
}

export function parsePrepRefs(value: string | null | undefined): PrepRefs {
  if (!value) return emptyPrepRefs();
  try {
    const parsed = JSON.parse(value) as Partial<PrepRefs>;
    const pastLessonLinks = parsePastLessonLinks(parsed.pastLessonLinks);
    const pastLessons = Array.isArray(parsed.pastLessons)
      ? parsed.pastLessons.map(String)
      : pastLessonLinks.map((l) => l.label);
    return {
      course: String(parsed.course ?? ""),
      level: String(parsed.level ?? ""),
      goals: String(parsed.goals ?? ""),
      pastLessons,
      pastLessonLinks,
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String) : [],
      vocab: Array.isArray(parsed.vocab) ? parsed.vocab.map(String) : [],
      generationSource: parseGenerationSource(parsed.generationSource),
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
      refs.pastLessonLinks.length ||
      refs.topics.length ||
      refs.weaknesses.length ||
      refs.vocab.length,
  );
}

export function withEditedGeneration(refs: PrepRefs): PrepRefs {
  return { ...refs, generationSource: "edited" };
}
