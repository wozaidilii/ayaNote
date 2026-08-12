import { generateObject } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const summarySchema = z.object({
  topics: z.array(z.string()).min(3).max(12),
  todaySummary: z.string(),
  priorReview: z.string(),
  vocab: z.array(
    z.object({
      term: z.string(),
      reading: z.string().optional().default(""),
      meaning: z.string().optional().default(""),
    }),
  ),
  grammar: z.array(
    z.object({
      pattern: z.string(),
      notes: z.string().optional().default(""),
    }),
  ),
  examples: z.array(
    z.object({
      pattern: z.string(),
      examples: z.array(z.string()).min(2).max(6),
    }),
  ),
  mistakes: z.array(z.string()),
  homework: z.string(),
  nextFocus: z.string(),
  notes: z.string(),
});

const prepSchema = z.object({
  warmup: z.string(),
  review: z.string(),
  newFocus: z.string(),
  practice: z.string(),
  homeworkSeed: z.string(),
});

export type LessonSummaryPayload = z.infer<typeof summarySchema>;
export type PrepDraftPayload = z.infer<typeof prepSchema>;
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
  const lines = transcript
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  const topics = lines.slice(0, 5).map((l) => l.slice(0, 80));
  const topicLine = topics[0] ?? "Continue conversation practice";
  return {
    topics: topics.length ? topics : ["General conversation practice"],
    todaySummary:
      lines.slice(0, 3).join(" ") ||
      "Conversation practice covering everyday phrases.",
    priorReview: "No prior lesson memory available.",
    vocab: [],
    grammar: [],
    examples: [],
    mistakes: [],
    homework:
      "Review today's conversation phrases aloud once and write 5 example sentences.",
    nextFocus: `Next lesson: deepen ${topicLine}. Warm up with today's phrases, then practice a short role-play and correct form accuracy.`,
    notes:
      reason ??
      "Generated locally without an AI API key. Set DEEPSEEK_API_KEY (default) or OPENAI_API_KEY. Edit before approving.",
  };
}

function heuristicPrep(input: {
  studentName: string;
  level: string;
  courseType?: string;
  lastTopics: string[];
  weaknesses: string[];
}): PrepDraftPayload {
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

  try {
    const { object } = await generateObject({
      model,
      schema: summarySchema,
      prompt: `You are an experienced Japanese 1v1 teacher writing a lesson record a teacher can scan in seconds, then use for next-class prep.
Be specific and useful. Prefer Japanese for linguistic content; English glosses OK.
${partNote}
${block}

Return JSON with:
- topics: 5–10 short highlight phrases from THIS segment (scannable chips, e.g. ビジネスメールの敬語 / 期間の表現)
- todaySummary: EXACTLY 2–4 sentences summarizing what you practiced in this segment
- priorReview: how this segment recycled previous vocab/grammar; if none, say what to recycle next time
- vocab: 8–15 items from this segment (term, reading, meaning)
- grammar: 4–8 patterns from this segment with short notes
- examples: for EACH key grammar pattern, give 3–5 natural example sentences
- mistakes: corrections like 「X」→「Y」with brief why
- homework: concrete writing/speaking task matching the course track
- nextFocus: next-lesson direction in 2–4 sentences
- notes: teacher memo

Match tone to course:
- jlpt_*: exam-aware forms and patterns
- business: polite/keigo email & workplace
- casual: natural spoken Japanese
- travel: practical phrases
(Course: ${course})

TRANSCRIPT:
${transcriptChunk}`,
    });
    return {
      ...object,
      notes: object.notes?.trim()
        ? `${object.notes} (via ${getAiProvider()})`
        : `Summarized via ${getAiProvider()}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return heuristicSummary(
      transcriptChunk,
      `AI summary failed (${getAiProvider()}): ${message}. Fell back to local heuristic. Edit before approving.`,
    );
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
Weak points: ${input.weaknesses.join(", ") || "n/a"}
Recent vocab: ${input.vocab.join(", ") || "n/a"}
Last lesson todaySummary (what was practiced — build continuity):
${todaySummary || "n/a"}
Last nextFocus / 次回の授業提案 (PRIMARY direction for this prep — honor this unless clearly outdated):
${nextFocus || "n/a"}
Last classroom board (what was written together in the previous session — reuse unfinished threads):
${board || "n/a"}

Return warmup, review (include example sentences using last grammar), newFocus, practice, homeworkSeed.
Match register to course (business keigo / casual / JLPT patterns / travel).
Keep each section actionable; Japanese phrases welcome.
If nextFocus is present, newFocus and practice must clearly advance that proposal.`,
    });
    return object;
  } catch {
    return heuristicPrep(input);
  }
}
