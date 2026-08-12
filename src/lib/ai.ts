import { generateObject } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

/** Soft schema — DeepSeek structured output often omits nested mins and fails hard. */
const summarySchema = z.object({
  topics: z.array(z.string()).max(12).default([]),
  todaySummary: z.string().default(""),
  priorReview: z.string().default(""),
  vocab: z
    .array(
      z.object({
        term: z.string(),
        reading: z.string().optional().default(""),
        meaning: z.string().optional().default(""),
      }),
    )
    .max(20)
    .default([]),
  grammar: z
    .array(
      z.object({
        pattern: z.string(),
        notes: z.string().optional().default(""),
      }),
    )
    .max(12)
    .default([]),
  examples: z
    .array(
      z.object({
        pattern: z.string(),
        examples: z.array(z.string()).max(6).default([]),
      }),
    )
    .max(10)
    .default([]),
  mistakes: z.array(z.string()).max(20).default([]),
  homework: z.string().default(""),
  nextFocus: z.string().default(""),
  notes: z.string().default(""),
});

const vocabRecallItemSchema = z.object({
  /** Japanese sentence with the target replaced by ＿＿ (or ___) */
  blanked: z.string(),
  /** Short meaning/summary cue shown as （hint） next to the blank */
  hint: z.string().default(""),
  /** Correct word/phrase that fills ＿＿ */
  answer: z.string(),
});

const prepSchema = z.object({
  warmup: z.string().default(""),
  review: z.string().default(""),
  newFocus: z.string().default(""),
  practice: z.string().default(""),
  homeworkSeed: z.string().default(""),
  vocabRecall: z.array(vocabRecallItemSchema).max(8).default([]),
});

export function isHeuristicSummaryNotes(notes: string | null | undefined) {
  const n = notes ?? "";
  return /Fell back|Generated locally|AI summary failed|AI summary unavailable|要再生成|local heuristic|Local fallback/i.test(
    n,
  );
}

/** Detect older local-fallback summaries even if notes were edited away. */
export function looksLikeHeuristicSummary(summary: {
  notes?: string | null;
  homework?: string | null;
  topicsJson?: string | null;
}) {
  if (isHeuristicSummaryNotes(summary.notes)) return true;
  if (
    /Review today's conversation phrases aloud/i.test(summary.homework ?? "")
  ) {
    return true;
  }
  try {
    const topics = JSON.parse(summary.topicsJson || "[]") as unknown;
    if (
      Array.isArray(topics) &&
      topics.some(
        (t) =>
          typeof t === "string" &&
          (t.length > 60 || /お!来た|OK じゃあ|グループミーティング/.test(t)),
      )
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export type LessonSummaryPayload = z.infer<typeof summarySchema>;
export type PrepDraftPayload = z.infer<typeof prepSchema>;
export type VocabRecallItem = z.infer<typeof vocabRecallItemSchema>;
export type AiProvider = "deepseek" | "openai";

export const COURSE_TYPES = [
  { value: "jlpt_n1", label: "JLPT N1" },
  { value: "jlpt_n2", label: "JLPT N2" },
  { value: "jlpt_n3", label: "JLPT N3" },
  { value: "jlpt_n4", label: "JLPT N4" },
  { value: "jlpt_n5", label: "JLPT N5" },
  { value: "business", label: "Business Japanese" },
  { value: "casual", label: "Casual talk" },
  { value: "travel", label: "Travel Japanese" },
  { value: "custom", label: "Custom" },
] as const;

export type CourseType = (typeof COURSE_TYPES)[number]["value"];

export function courseTypeLabel(value: string) {
  return COURSE_TYPES.find((c) => c.value === value)?.label ?? value;
}

function heuristicSummary(
  transcript: string,
  reason?: string,
): LessonSummaryPayload {
  const charCount = transcript.trim().length;
  return {
    topics: ["(AI summary unavailable — regenerate)"],
    todaySummary:
      charCount > 0
        ? `Local fallback only (${charCount} transcript chars). Regenerate summary after fixing AI, or edit manually.`
        : "No transcript text available.",
    priorReview: "No AI summary — prior review not extracted.",
    vocab: [],
    grammar: [],
    examples: [],
    mistakes: [],
    homework: "（要再生成）今日の会話から語彙・表現を5文で書いてください。",
    nextFocus:
      "（要再生成）次回は本レッスンの弱点語彙・言い淀みを穴埋めで復習し、短いロールプレイで定着させてください。",
    notes:
      reason ??
      "Generated locally without an AI API key. Set DEEPSEEK_API_KEY (default) or OPENAI_API_KEY. Edit before approving.",
  };
}

function normalizeSummary(object: LessonSummaryPayload): LessonSummaryPayload {
  const topics = object.topics.map((t) => t.trim()).filter(Boolean);
  return {
    ...object,
    topics: topics.length ? topics.slice(0, 12) : ["Conversation practice"],
    todaySummary: object.todaySummary.trim() || "Lesson practice recorded.",
    priorReview: object.priorReview.trim() || "—",
    vocab: object.vocab.filter((v) => v.term.trim()).slice(0, 15),
    grammar: object.grammar.filter((g) => g.pattern.trim()).slice(0, 10),
    examples: object.examples
      .map((e) => ({
        pattern: e.pattern,
        examples: e.examples
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6),
      }))
      .filter((e) => e.pattern.trim() && e.examples.length > 0)
      .slice(0, 8),
    mistakes: object.mistakes
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 15),
    homework:
      object.homework.trim() ||
      "今日の表現を声に出して復習し、5文書いてください。",
    nextFocus:
      object.nextFocus.trim() ||
      "次回は今日の語彙・言い間違いを復習してから新フォーカスへ。",
    notes: object.notes.trim(),
  };
}

function heuristicPrep(input: {
  studentName: string;
  level: string;
  courseType?: string;
  lastTopics: string[];
  weaknesses: string[];
  vocab?: string[];
}): PrepDraftPayload {
  const recallTerms = [
    ...input.weaknesses
      .map((w) => w.replace(/^「(.+?)」.*/, "$1").trim())
      .filter(Boolean),
    ...(input.vocab ?? []),
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  return {
    warmup: `5-minute small talk with ${input.studentName} (${courseTypeLabel(input.courseType ?? input.level)}).`,
    review: input.lastTopics.length
      ? `Quick review: ${input.lastTopics.slice(0, 3).join(" / ")}`
      : "Review previous homework and greetings.",
    newFocus: input.weaknesses[0]
      ? `Focus on: ${input.weaknesses[0]}`
      : "Introduce one new practical phrase set.",
    practice:
      "Role-play a short real-life dialogue; correct gently and recycle key forms.",
    homeworkSeed: "Write 5 sentences using today's target phrases.",
    vocabRecall: recallTerms.slice(0, 5).map((term) => ({
      blanked: `これは＿＿の使い方の例です。`,
      hint: term.slice(0, 24) || "meaning",
      answer: term,
    })),
  };
}

/** Default provider is DeepSeek. Set AYANOTE_AI_PROVIDER=openai to switch. */
export function getAiProvider(): AiProvider {
  const raw = (process.env.AYANOTE_AI_PROVIDER ?? "deepseek").toLowerCase();
  return raw === "openai" ? "openai" : "deepseek";
}

function getModel() {
  const provider = getAiProvider();

  if (provider === "deepseek") {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return null;
    const deepseek = createDeepSeek({ apiKey: key });
    return deepseek(process.env.AYANOTE_MODEL ?? "deepseek-chat");
  }

  const key = process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  const openai = createOpenAI({ apiKey: key });
  return openai(process.env.AYANOTE_MODEL ?? "gpt-4o-mini");
}

function missingKeyNote() {
  const provider = getAiProvider();
  if (provider === "deepseek") {
    return "Generated locally — DEEPSEEK_API_KEY is missing (default provider). Edit before approving.";
  }
  return "Generated locally — OPENAI_API_KEY is missing. Edit before approving.";
}

export type SummarizeContext = {
  studentName?: string;
  level?: string;
  courseType?: string;
  goals?: string;
  priorTopics?: string[];
  priorVocab?: Array<{ term: string; reading?: string; meaning?: string }>;
  priorGrammar?: Array<{ pattern: string; notes?: string }>;
  priorNextFocus?: string;
  /** Plain text from the collaborative classroom board */
  classroomBoard?: string;
};

const CHUNK_CHARS = 12000;

function buildContextBlock(context: SummarizeContext) {
  const course = courseTypeLabel(
    context.courseType || context.level || "custom",
  );
  const priorVocab = (context.priorVocab ?? [])
    .slice(0, 15)
    .map(
      (v) => `${v.term}${v.reading ? `(${v.reading})` : ""} ${v.meaning ?? ""}`,
    )
    .join(" · ");
  const priorGrammar = (context.priorGrammar ?? [])
    .slice(0, 10)
    .map((g) => `${g.pattern}${g.notes ? ` — ${g.notes}` : ""}`)
    .join(" · ");

  return {
    course,
    block: `Student: ${context.studentName ?? "unknown"}
Course track: ${course}
Level field: ${context.level ?? "n/a"}
Goals: ${context.goals || "n/a"}
Prior topics: ${(context.priorTopics ?? []).join(" · ") || "n/a"}
Prior vocab bank: ${priorVocab || "n/a"}
Prior grammar bank: ${priorGrammar || "n/a"}
Last nextFocus: ${context.priorNextFocus || "n/a"}

Classroom board notes (collaborative lesson board written during class — treat as ground truth for what was planned/practiced on the board):
${(context.classroomBoard ?? "").trim().slice(0, 6000) || "n/a"}`,
  };
}

function splitTranscriptChunks(transcript: string, size = CHUNK_CHARS) {
  const text = transcript.trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("。"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n"),
      );
      if (breakAt > size * 0.4) end = start + breakAt + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

async function summarizeSingleChunk(
  transcriptChunk: string,
  context: SummarizeContext,
  opts?: { partLabel?: string },
): Promise<LessonSummaryPayload> {
  const model = getModel();
  if (!model || !transcriptChunk.trim()) {
    return heuristicSummary(transcriptChunk, missingKeyNote());
  }

  const { course, block } = buildContextBlock(context);
  const partNote = opts?.partLabel
    ? `\nThis is ${opts.partLabel} of a longer lesson — extract what happened in THIS segment only.\n`
    : "";
  // Cap chunk text so structured JSON has room in the context window.
  const chunk = transcriptChunk.slice(0, 9000);

  const run = async (prompt: string) => {
    const { object } = await generateObject({
      model,
      schema: summarySchema,
      prompt,
    });
    const normalized = normalizeSummary(object);
    return {
      ...normalized,
      notes: normalized.notes
        ? `${normalized.notes} (via ${getAiProvider()})`
        : `Summarized via ${getAiProvider()}.`,
    };
  };

  const fullPrompt = `You are an experienced Japanese 1v1 teacher writing a lesson record a teacher can scan in seconds, then use for next-class prep.
Be specific and useful. Prefer Japanese for linguistic content; English glosses OK.
Do NOT copy raw transcript lines into topics — topics must be short theme labels (e.g. 自己紹介 / 仕事の説明 / ソフトウェア開発の語彙).
${partNote}
${block}

Return JSON with:
- topics: 5–10 short highlight phrases (NOT transcript quotes)
- todaySummary: EXACTLY 2–4 sentences summarizing what you practiced
- priorReview: how this recycled previous vocab/grammar; if none, say what to recycle next time
- vocab: 8–15 items (term, reading, meaning) — prioritize words the student struggled to produce/remember
- grammar: 4–8 patterns with short notes
- examples: for key grammar patterns, 2–5 natural example sentences each (OK to return [] if unsure)
- mistakes: corrections like 「X」→「Y」with brief why
- homework: concrete writing/speaking task matching the course track
- nextFocus: next-lesson direction in 2–4 sentences
- notes: teacher memo

Match tone to course (${course}): jlpt_* exam forms / business keigo / casual spoken / travel phrases.

TRANSCRIPT:
${chunk}`;

  try {
    return await run(fullPrompt);
  } catch (err1) {
    const message1 = err1 instanceof Error ? err1.message : "unknown error";
    console.error("AI summary attempt 1 failed:", message1);
    try {
      return await run(`Japanese 1v1 lesson summary. Return compact JSON fields:
topics (short labels), todaySummary (2-4 sentences), priorReview, vocab[{term,reading,meaning}], grammar[{pattern,notes}], examples[{pattern,examples[]}], mistakes[], homework, nextFocus, notes.
Prefer Japanese for linguistic content. Do not paste transcript into topics.
Student/course context:
${block}

TRANSCRIPT:
${chunk.slice(0, 6000)}`);
    } catch (err2) {
      const message2 = err2 instanceof Error ? err2.message : "unknown error";
      console.error("AI summary attempt 2 failed:", message2);
      return heuristicSummary(
        transcriptChunk,
        `AI summary failed (${getAiProvider()}): ${message2}. Fell back to local heuristic. Use「再生成」with the stored transcript. First error: ${message1}`,
      );
    }
  }
}

function mergeSummaryParts(
  parts: LessonSummaryPayload[],
  fallbackTranscript: string,
): LessonSummaryPayload {
  if (parts.length === 0) return heuristicSummary(fallbackTranscript);
  if (parts.length === 1) return parts[0]!;

  const uniq = <T>(items: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  };

  const topics = uniq(
    parts.flatMap((p) => p.topics),
    (t) => t.trim().toLowerCase(),
  ).slice(0, 12);
  const vocab = uniq(
    parts.flatMap((p) => p.vocab),
    (v) => v.term.trim().toLowerCase(),
  ).slice(0, 15);
  const grammar = uniq(
    parts.flatMap((p) => p.grammar),
    (g) => g.pattern.trim().toLowerCase(),
  ).slice(0, 8);
  const examples = uniq(
    parts.flatMap((p) => p.examples),
    (e) => e.pattern.trim().toLowerCase(),
  ).slice(0, 8);
  const mistakes = uniq(
    parts.flatMap((p) => p.mistakes),
    (m) => m.trim().toLowerCase(),
  ).slice(0, 12);

  const todaySummary = parts
    .map((p) => p.todaySummary.trim())
    .filter(Boolean)
    .join(" ");
  const last = parts[parts.length - 1]!;

  return {
    topics: topics.length ? topics : ["General conversation practice"],
    todaySummary:
      todaySummary.slice(0, 1200) ||
      "Conversation practice covering everyday phrases.",
    priorReview: parts[0]?.priorReview || last.priorReview,
    vocab,
    grammar,
    examples,
    mistakes,
    homework: last.homework || parts.find((p) => p.homework)?.homework || "",
    nextFocus:
      last.nextFocus || parts.find((p) => p.nextFocus)?.nextFocus || "",
    notes: parts
      .map((p) => p.notes.trim())
      .filter(Boolean)
      .slice(-2)
      .join(" · "),
  };
}

async function mergeSummariesWithAi(
  parts: LessonSummaryPayload[],
  context: SummarizeContext,
): Promise<LessonSummaryPayload | null> {
  const model = getModel();
  if (!model || parts.length < 2) return null;

  const { block } = buildContextBlock(context);
  const condensed = parts
    .map(
      (p, i) => `--- Part ${i + 1} ---
topics: ${p.topics.join(" · ")}
todaySummary: ${p.todaySummary}
priorReview: ${p.priorReview}
vocab: ${p.vocab.map((v) => v.term).join(", ")}
grammar: ${p.grammar.map((g) => g.pattern).join(", ")}
mistakes: ${p.mistakes.join(" · ")}
homework: ${p.homework}
nextFocus: ${p.nextFocus}
notes: ${p.notes}`,
    )
    .join("\n\n")
    .slice(0, 24000);

  try {
    const { object } = await generateObject({
      model,
      schema: summarySchema,
      prompt: `Merge these partial Japanese 1v1 lesson summaries into ONE coherent lesson record for the full class.
Deduplicate topics/vocab/grammar. todaySummary should cover the whole lesson in 2–4 sentences.
homework and nextFocus should reflect the FULL lesson (prefer later parts if they refined the plan).

${block}

PARTIAL SUMMARIES:
${condensed}`,
    });
    return {
      ...object,
      notes: object.notes?.trim()
        ? `${object.notes} (via ${getAiProvider()}, map-reduce)`
        : `Summarized via ${getAiProvider()} (map-reduce).`,
    };
  } catch {
    return null;
  }
}

/**
 * Summarize a transcript. Long transcripts are chunked (map) then merged (reduce)
 * so 30–60 min lessons are not truncated at 14k chars.
 */
export async function summarizeTranscript(
  transcript: string,
  context: SummarizeContext = {},
): Promise<LessonSummaryPayload> {
  if (!transcript.trim()) {
    return heuristicSummary(transcript, missingKeyNote());
  }

  const chunks = splitTranscriptChunks(transcript);
  if (chunks.length <= 1) {
    return summarizeSingleChunk(chunks[0] ?? transcript, context);
  }

  const partials: LessonSummaryPayload[] = [];
  for (let i = 0; i < chunks.length; i++) {
    partials.push(
      await summarizeSingleChunk(chunks[i]!, context, {
        partLabel: `segment ${i + 1} of ${chunks.length}`,
      }),
    );
  }

  const merged =
    (await mergeSummariesWithAi(partials, context)) ??
    mergeSummaryParts(partials, transcript);
  return merged;
}

export async function generatePrepDraft(input: {
  studentName: string;
  level: string;
  courseType?: string;
  goals: string;
  lastTopics: string[];
  weaknesses: string[];
  vocab: string[];
  /** Recent classroom board plain text (last completed lesson) */
  lastClassroomBoard?: string;
  /** Approved next-lesson proposal from last summary */
  priorNextFocus?: string;
  /** Last lesson todaySummary narrative */
  lastTodaySummary?: string;
}): Promise<PrepDraftPayload> {
  const model = getModel();
  if (!model) return heuristicPrep(input);

  const course = courseTypeLabel(input.courseType || input.level);
  const board = (input.lastClassroomBoard ?? "").trim().slice(0, 5000);
  const nextFocus = (input.priorNextFocus ?? "").trim().slice(0, 2000);
  const todaySummary = (input.lastTodaySummary ?? "").trim().slice(0, 2000);

  try {
    const { object } = await generateObject({
      model,
      schema: prepSchema,
      prompt: `Create a 50-minute Japanese 1v1 lesson prep draft tailored to the course track.
Student: ${input.studentName}
Course: ${course}
Level: ${input.level}
Goals: ${input.goals || "n/a"}
Recent topics: ${input.lastTopics.join(", ") || "n/a"}
Weak points / mistakes to recycle: ${input.weaknesses.join(", ") || "n/a"}
Priority vocab to recall (prefer these for cloze): ${input.vocab.join(", ") || "n/a"}
Last lesson todaySummary (what was practiced — build continuity):
${todaySummary || "n/a"}
Last nextFocus / 次回の授業提案 (PRIMARY direction for this prep — honor this unless clearly outdated):
${nextFocus || "n/a"}
Last classroom board (what was written together in the previous session — reuse unfinished threads):
${board || "n/a"}

Return warmup, review (include example sentences using last grammar), newFocus, practice, homeworkSeed,
and vocabRecall: 4–6 short Japanese cloze sentences for oral warm-up.

vocabRecall format (strict):
- blanked: natural Japanese sentence with ONE blank written as ＿＿ (fullwidth underscores). Example: 「これは昨日行った＿＿です。」
- hint: short meaning/summary cue for the missing word (English or simple Japanese), NOT the answer itself. Example: "library" or "静かな場所"
- answer: the exact Japanese word/phrase that fills ＿＿. Example: "図書館"
UI will display as: これは昨日行った＿＿(library)です。 — student sees the hint, hovers blank to reveal answer.
Prioritize words the student struggled with or must re-memorize (from weak points + priority vocab). Level-appropriate.
Match register to course (business keigo / casual / JLPT patterns / travel).
Keep each section actionable; Japanese phrases welcome.
If nextFocus is present, newFocus and practice must clearly advance that proposal.
If there is no usable vocab/weak list, return vocabRecall as [].`,
    });
    return {
      ...object,
      vocabRecall: object.vocabRecall ?? [],
    };
  } catch {
    return heuristicPrep(input);
  }
}
