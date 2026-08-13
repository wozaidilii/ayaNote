import type { VocabForQuiz, QuizQuestion } from "@/lib/homework-quiz";
import { buildQuizFromVocab } from "@/lib/homework-quiz";

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";

const LEVEL_VOCAB: Record<JlptLevel, VocabForQuiz[]> = {
  N5: [
    { term: "食べる", reading: "たべる", meaning: "to eat" },
    { term: "飲む", reading: "のむ", meaning: "to drink" },
    { term: "学校", reading: "がっこう", meaning: "school" },
    { term: "先生", reading: "せんせい", meaning: "teacher" },
    { term: "友達", reading: "ともだち", meaning: "friend" },
    { term: "今日", reading: "きょう", meaning: "today" },
    { term: "明日", reading: "あした", meaning: "tomorrow" },
    { term: "大きい", reading: "おおきい", meaning: "big" },
    { term: "小さい", reading: "ちいさい", meaning: "small" },
    { term: "時間", reading: "じかん", meaning: "time" },
    { term: "電車", reading: "でんしゃ", meaning: "train" },
    { term: "買う", reading: "かう", meaning: "to buy" },
  ],
  N4: [
    { term: "経験", reading: "けいけん", meaning: "experience" },
    { term: "約束", reading: "やくそく", meaning: "promise / appointment" },
    { term: "都合", reading: "つごう", meaning: "convenience / schedule" },
    { term: "準備", reading: "じゅんび", meaning: "preparation" },
    { term: "必要", reading: "ひつよう", meaning: "necessary" },
    { term: "心配", reading: "しんぱい", meaning: "worry" },
    { term: "説明", reading: "せつめい", meaning: "explanation" },
    { term: "意見", reading: "いけん", meaning: "opinion" },
    { term: "急ぐ", reading: "いそぐ", meaning: "to hurry" },
    { term: "続ける", reading: "つづける", meaning: "to continue" },
    { term: "確認", reading: "かくにん", meaning: "confirmation" },
    { term: "予定", reading: "よてい", meaning: "plan / schedule" },
  ],
  N3: [
    { term: "影響", reading: "えいきょう", meaning: "influence / effect" },
    { term: "傾向", reading: "けいこう", meaning: "tendency" },
    { term: "解決", reading: "かいけつ", meaning: "solution / resolution" },
    { term: "状況", reading: "じょうきょう", meaning: "situation" },
    { term: "判断", reading: "はんだん", meaning: "judgment" },
    { term: "可能", reading: "かのう", meaning: "possible" },
    { term: "結果", reading: "けっか", meaning: "result" },
    { term: "原因", reading: "げんいん", meaning: "cause" },
    { term: "提出", reading: "ていしゅつ", meaning: "submission" },
    { term: "優先", reading: "ゆうせん", meaning: "priority" },
    { term: "改善", reading: "かいぜん", meaning: "improvement" },
    { term: "比較", reading: "ひかく", meaning: "comparison" },
  ],
  N2: [
    { term: "検討", reading: "けんとう", meaning: "consideration / review" },
    { term: "指摘", reading: "してき", meaning: "pointing out" },
    { term: "配慮", reading: "はいりょ", meaning: "consideration / care" },
    { term: "妥当", reading: "だとう", meaning: "appropriate / valid" },
    { term: "遂行", reading: "すいこう", meaning: "carrying out" },
    { term: "促進", reading: "そくしん", meaning: "promotion / acceleration" },
    { term: "把握", reading: "はあく", meaning: "grasp / understanding" },
    { term: "懸念", reading: "けねん", meaning: "concern" },
    { term: "妥協", reading: "だきょう", meaning: "compromise" },
    { term: "措置", reading: "そち", meaning: "measure / step" },
    { term: "顕著", reading: "けんちょ", meaning: "remarkable" },
    { term: "曖昧", reading: "あいまい", meaning: "ambiguous" },
  ],
  N1: [
    { term: "緻密", reading: "ちみつ", meaning: "precise / meticulous" },
    { term: "示唆", reading: "しさ", meaning: "suggestion / implication" },
    { term: "斡旋", reading: "あっせん", meaning: "mediation / arrangement" },
    { term: "罷免", reading: "ひめん", meaning: "dismissal from office" },
    { term: "踏襲", reading: "とうしゅう", meaning: "following a precedent" },
    { term: "顛末", reading: "てんまつ", meaning: "full account of events" },
    { term: "危惧", reading: "きぐ", meaning: "apprehension / fear" },
    { term: "緩和", reading: "かんわ", meaning: "easing / mitigation" },
    { term: "黙認", reading: "もくにん", meaning: "tacit approval" },
    { term: "憤慨", reading: "ふんがい", meaning: "indignation" },
    { term: "停滞", reading: "ていたい", meaning: "stagnation" },
    { term: "示唆的", reading: "しさてき", meaning: "suggestive" },
  ],
};

/** Normalize student.level / courseType into N5–N1. */
export function normalizeJlptLevel(
  level: string,
  courseType?: string,
): JlptLevel {
  const raw = `${level} ${courseType ?? ""}`.toUpperCase();
  if (/\bN1\b|JLPT_N1/.test(raw)) return "N1";
  if (/\bN2\b|JLPT_N2/.test(raw)) return "N2";
  if (/\bN3\b|JLPT_N3/.test(raw)) return "N3";
  if (/\bN5\b|JLPT_N5/.test(raw)) return "N5";
  return "N4";
}

/**
 * Build a fixed 10-question placement-style quiz for a JLPT level.
 * Prefer reading + meaning pairs from the level bank.
 */
export function buildSampleQuizForLevel(
  level: string,
  courseType?: string,
): { jlpt: JlptLevel; questions: QuizQuestion[] } {
  const jlpt = normalizeJlptLevel(level, courseType);
  const bank = LEVEL_VOCAB[jlpt];
  // buildQuizFromVocab may produce up to 12; trim to 10
  const questions = buildQuizFromVocab(bank).slice(0, 10);
  // Re-id for stable sample quiz ids
  const renumbered = questions.map((q, i) => ({
    ...q,
    id: `sample-${jlpt.toLowerCase()}-q${i + 1}`,
  }));
  return { jlpt, questions: renumbered };
}

export function sampleQuizTitle(jlpt: JlptLevel) {
  return `Level check · ${jlpt}`;
}

export function sampleQuizInstructions(jlpt: JlptLevel) {
  return `Sample vocabulary quiz for ${jlpt} (10 questions). Try it to see your current level.`;
}
