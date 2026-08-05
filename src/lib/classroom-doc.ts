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

/** Flatten TipTap JSON to plain text for AI prompts / search. */
export function tiptapDocToPlainText(
  doc: TiptapDoc | null | undefined,
): string {
  if (!doc?.content?.length) return "";
  const lines: string[] = [];

  const walk = (node: TiptapNode, depth = 0) => {
    if (node.type === "text" && node.text) {
      lines.push(node.text);
      return;
    }
    if (node.type === "hardBreak") {
      lines.push("\n");
      return;
    }
    if (node.type === "heading") {
      const level = Number(node.attrs?.level ?? 2);
      const prefix = "#".repeat(Math.min(Math.max(level, 1), 3)) + " ";
      const inner: string[] = [];
      for (const child of node.content ?? []) {
        if (child.type === "text" && child.text) inner.push(child.text);
      }
      lines.push(`\n${prefix}${inner.join("")}\n`);
      return;
    }
    if (node.type === "paragraph" || node.type === "listItem") {
      const inner: string[] = [];
      for (const child of node.content ?? []) {
        if (child.type === "text" && child.text) inner.push(child.text);
        else if (child.content) {
          for (const c of child.content) {
            if (c.type === "text" && c.text) inner.push(c.text);
          }
        }
      }
      const text = inner.join("").trim();
      if (text) lines.push(text);
      else if (node.type === "paragraph") lines.push("");
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      for (const child of node.content ?? []) walk(child, depth + 1);
      return;
    }
    for (const child of node.content ?? []) walk(child, depth);
  };

  for (const node of doc.content) walk(node);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
