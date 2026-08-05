/**
 * TipTap JSON helpers for the classroom board document.
 * Server-safe (no TipTap imports).
 */

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

function textNode(text: string): TiptapNode {
  return { type: "text", text };
}

function heading(text: string, level = 2): TiptapNode {
  return {
    type: "heading",
    attrs: { level },
    content: text ? [textNode(text)] : [],
  };
}

function paragraph(text: string): TiptapNode {
  const trimmed = text.trim();
  if (!trimmed) return { type: "paragraph" };
  return {
    type: "paragraph",
    content: [textNode(trimmed)],
  };
}

function section(title: string, body: string): TiptapNode[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const paras =
    lines.length === 0 || (lines.length === 1 && !lines[0].trim())
      ? [paragraph("")]
      : lines.map((line) => paragraph(line));
  return [heading(title), ...paras];
}

export function seedClassroomDoc(opts: {
  warmup?: string;
  review?: string;
  newFocus?: string;
  practice?: string;
  homeworkSeed?: string;
  classroomNotes?: string;
}): TiptapDoc {
  return {
    type: "doc",
    content: [
      ...section("Warmup", opts.warmup ?? ""),
      ...section("Review", opts.review ?? ""),
      ...section("New focus", opts.newFocus ?? ""),
      ...section("Practice", opts.practice ?? ""),
      ...section("Homework", opts.homeworkSeed ?? ""),
      ...section("Notes", opts.classroomNotes ?? ""),
    ],
  };
}

export function emptyClassroomDoc(): TiptapDoc {
  return seedClassroomDoc({});
}

export function parseClassroomDoc(
  raw: string | null | undefined,
): TiptapDoc | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as TiptapDoc;
    if (parsed?.type === "doc" && Array.isArray(parsed.content)) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function serializeClassroomDoc(doc: TiptapDoc): string {
  return JSON.stringify(doc);
}
