import { generateObject } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const summarySchema = z.object({
  topics: z.array(z.string()),
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

function heuristicSummary(transcript: string, reason?: string): LessonSummaryPayload {
  const lines = transcript
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  const topics = lines.slice(0, 3).map((l) => l.slice(0, 80));
  return {
    topics: topics.length ? topics : ["General conversation practice"],
    vocab: [],
    grammar: [],
    mistakes: [],
    homework: "Review today's conversation phrases aloud once.",
    nextFocus: topics[0] ?? "Continue conversation practice",
    notes:
      reason ??
      "Generated locally without an AI API key. Set DEEPSEEK_API_KEY (default) or OPENAI_API_KEY. Edit before approving.",
  };
}

function heuristicPrep(input: {
  studentName: string;
  level: string;
  lastTopics: string[];
  weaknesses: string[];
}): PrepDraftPayload {
  return {
    warmup: `5-minute small talk with ${input.studentName} (level ${input.level}).`,
    review: input.lastTopics.length
      ? `Quick review: ${input.lastTopics.slice(0, 3).join(" / ")}`
      : "Review previous homework and greetings.",
    newFocus: input.weaknesses[0]
      ? `Focus on: ${input.weaknesses[0]}`
      : "Introduce one new practical phrase set.",
    practice: "Role-play a short real-life dialogue; correct gently and recycle key forms.",
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

export async function summarizeTranscript(transcript: string): Promise<LessonSummaryPayload> {
  const model = getModel();
  if (!model || !transcript.trim()) {
    return heuristicSummary(transcript, missingKeyNote());
  }

  try {
    const { object } = await generateObject({
      model,
      schema: summarySchema,
      prompt: `You are helping a Japanese 1v1 teacher. Summarize this lesson transcript for student memory.
Return concise JSON fields: topics, vocab (term/reading/meaning), grammar (pattern/notes), mistakes, homework, nextFocus, notes.
Transcript may mix Japanese and English.
Write homework/nextFocus/notes in the same language mix the teacher would use (Japanese OK).

TRANSCRIPT:
${transcript.slice(0, 12000)}`,
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
  goals: string;
  lastTopics: string[];
  weaknesses: string[];
  vocab: string[];
}): Promise<PrepDraftPayload> {
  const model = getModel();
  if (!model) return heuristicPrep(input);

  try {
    const { object } = await generateObject({
      model,
      schema: prepSchema,
      prompt: `Create a 50-minute Japanese 1v1 lesson prep draft.
Student: ${input.studentName}
Level: ${input.level}
Goals: ${input.goals || "n/a"}
Recent topics: ${input.lastTopics.join(", ") || "n/a"}
Weak points: ${input.weaknesses.join(", ") || "n/a"}
Recent vocab: ${input.vocab.join(", ") || "n/a"}

Return warmup, review, newFocus, practice, homeworkSeed. Keep each section short and actionable.
Japanese phrases in the plan are welcome.`,
    });
    return object;
  } catch {
    return heuristicPrep(input);
  }
}
