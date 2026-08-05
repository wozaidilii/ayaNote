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

export async function summarizeTranscript(
  transcript: string,
  context: SummarizeContext = {},
): Promise<LessonSummaryPayload> {
  const model = getModel();
  if (!model || !transcript.trim()) {
    return heuristicSummary(transcript, missingKeyNote());
  }

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

  try {
    const { object } = await generateObject({
      model,
      schema: summarySchema,
      prompt: `You are an experienced Japanese 1v1 teacher writing a lesson record a teacher can scan in seconds, then use for next-class prep.
Be specific and useful. Prefer Japanese for linguistic content; English glosses OK.

Student: ${context.studentName ?? "unknown"}
Course track: ${course}
Level field: ${context.level ?? "n/a"}
Goals: ${context.goals || "n/a"}
Prior topics: ${(context.priorTopics ?? []).join(" · ") || "n/a"}
Prior vocab bank: ${priorVocab || "n/a"}
Prior grammar bank: ${priorGrammar || "n/a"}
Last nextFocus: ${context.priorNextFocus || "n/a"}

Classroom board notes (collaborative lesson board written during class — treat as ground truth for what was planned/practiced on the board):
${(context.classroomBoard ?? "").trim().slice(0, 6000) || "n/a"}

Return JSON with:
- topics: 5–10 short highlight phrases from TODAY (scannable chips, e.g. ビジネスメールの敬語 / 期間の表現) — these are the lesson highlights
- todaySummary: EXACTLY 2–4 sentences summarizing what you practiced today (situations, themes, flow). No long paragraphs or bullet dumps.
- priorReview: how today's lesson recycled or should recycle previous vocab/grammar; if none, say what to recycle next time
- vocab: 8–15 items from today (term, reading, meaning)
- grammar: 4–8 patterns from today with short notes
- examples: for EACH key grammar pattern (and/or last lesson's focus grammar), give 3–5 natural example sentences the student can reuse (keigo if business course; casual if casual talk; JLPT-style if jlpt_*)
- mistakes: corrections like 「X」→「Y」with brief why
- homework: concrete writing/speaking task matching the course track (2–4 sentences of instructions)
- nextFocus: next-lesson direction in 2–4 sentences — goal + suggested practice angle a Prep draft can reuse directly
- notes: teacher memo (injury talk, JLPT timeline, motivation, etc.)

Match tone to course:
- jlpt_*: exam-aware forms and patterns
- business: polite/keigo email & workplace
- casual: natural spoken Japanese
- travel: practical phrases

TRANSCRIPT:
${transcript.slice(0, 14000)}`,
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
      transcript,
      `AI summary failed (${getAiProvider()}): ${message}. Fell back to local heuristic. Edit before approving.`,
    );
  }
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
}): Promise<PrepDraftPayload> {
  const model = getModel();
  if (!model) return heuristicPrep(input);

  const course = courseTypeLabel(input.courseType || input.level);
  const board = (input.lastClassroomBoard ?? "").trim().slice(0, 5000);

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
Last classroom board (what was written together in the previous session — reuse unfinished threads):
${board || "n/a"}

Return warmup, review (include example sentences using last grammar), newFocus, practice, homeworkSeed.
Match register to course (business keigo / casual / JLPT patterns / travel).
Keep each section actionable; Japanese phrases welcome.`,
    });
    return object;
  } catch {
    return heuristicPrep(input);
  }
}
