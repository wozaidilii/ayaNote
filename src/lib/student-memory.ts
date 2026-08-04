/** Normalize vocab/grammar keys for dedup (case/whitespace insensitive). */
export function normalizeMemoryKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type VocabIncoming = {
  term: string;
  reading?: string;
  meaning?: string;
};

export type VocabExisting = {
  id: string;
  term: string;
  reading: string;
  meaning: string;
};

export type GrammarIncoming = {
  pattern: string;
  notes?: string;
};

export type GrammarExisting = {
  id: string;
  pattern: string;
  notes: string;
};

export type VocabMergeOp =
  | { action: "create"; term: string; reading: string; meaning: string }
  | { action: "update"; id: string; reading: string; meaning: string };

export type GrammarMergeOp =
  | { action: "create"; pattern: string; notes: string }
  | { action: "update"; id: string; notes: string };

/** Plan creates/updates so approving the same summary twice does not duplicate bank rows. */
export function planVocabMerge(
  incoming: VocabIncoming[],
  existing: VocabExisting[],
  limit = 20,
): VocabMergeOp[] {
  const byKey = new Map(existing.map((e) => [normalizeMemoryKey(e.term), e]));
  const ops: VocabMergeOp[] = [];
  const seen = new Set<string>();

  for (const raw of incoming) {
    if (ops.length >= limit) break;
    const term = raw.term?.trim();
    if (!term) continue;
    const key = normalizeMemoryKey(term);
    if (seen.has(key)) continue;
    seen.add(key);

    const reading = (raw.reading ?? "").trim();
    const meaning = (raw.meaning ?? "").trim();
    const prev = byKey.get(key);

    if (!prev) {
      ops.push({ action: "create", term, reading, meaning });
      byKey.set(key, { id: "", term, reading, meaning });
      continue;
    }

    const nextReading = prev.reading.trim() ? prev.reading : reading;
    const nextMeaning = prev.meaning.trim() ? prev.meaning : meaning;
    if (
      prev.id &&
      (nextReading !== prev.reading || nextMeaning !== prev.meaning) &&
      (reading || meaning)
    ) {
      ops.push({ action: "update", id: prev.id, reading: nextReading, meaning: nextMeaning });
      byKey.set(key, { ...prev, reading: nextReading, meaning: nextMeaning });
    }
  }

  return ops;
}

export function planGrammarMerge(
  incoming: GrammarIncoming[],
  existing: GrammarExisting[],
  limit = 20,
): GrammarMergeOp[] {
  const byKey = new Map(existing.map((e) => [normalizeMemoryKey(e.pattern), e]));
  const ops: GrammarMergeOp[] = [];
  const seen = new Set<string>();

  for (const raw of incoming) {
    if (ops.length >= limit) break;
    const pattern = raw.pattern?.trim();
    if (!pattern) continue;
    const key = normalizeMemoryKey(pattern);
    if (seen.has(key)) continue;
    seen.add(key);

    const notes = (raw.notes ?? "").trim();
    const prev = byKey.get(key);

    if (!prev) {
      ops.push({ action: "create", pattern, notes });
      byKey.set(key, { id: "", pattern, notes });
      continue;
    }

    if (prev.id && !prev.notes.trim() && notes) {
      ops.push({ action: "update", id: prev.id, notes });
      byKey.set(key, { ...prev, notes });
    }
  }

  return ops;
}

/** Topics that are not echoed in mistake lines become strengths candidates. */
export function deriveStrengths(topics: string[], mistakes: string[], limit = 8): string[] {
  const mistakeBlob = mistakes.map(normalizeMemoryKey).join(" | ");
  const out: string[] = [];
  const seen = new Set<string>();

  for (const topic of topics) {
    const t = topic.trim();
    if (!t) continue;
    const key = normalizeMemoryKey(t);
    if (seen.has(key)) continue;
    if (mistakeBlob && mistakeBlob.includes(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeStringLists(
  existing: string[],
  incoming: string[],
  limit = 12,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...existing, ...incoming]) {
    const t = item.trim();
    if (!t) continue;
    const key = normalizeMemoryKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** Detect local/heuristic summary notes so UI can warn clearly. */
export function isHeuristicSummaryNotes(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /Generated locally|Fell back to local heuristic|DEEPSEEK_API_KEY is missing|OPENAI_API_KEY is missing/i.test(
    notes,
  );
}
