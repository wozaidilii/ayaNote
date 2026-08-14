/**
 * TipTap JSON helpers for the classroom board document.
 * Server-safe (no TipTap imports).
 */

import type { VocabRecallItem } from "@/lib/prep-refs";

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

const PREP_SECTION_TITLES = new Set([
  "Warmup",
  "Review",
  "New focus",
  "Practice",
  "Homework",
  "Notes",
  "Recall",
]);

/** Shared board: last lesson's cloze only (no teacher-only prep sections). */
export function seedClassroomDocFromCloze(
  items: VocabRecallItem[] | null | undefined,
): TiptapDoc {
  const cloze = items ?? [];
  if (cloze.length === 0) {
    return { type: "doc", content: [paragraph("")] };
  }
  return {
    type: "doc",
    content: [
      heading("Recall"),
      ...cloze.map((item) => {
        const hint = item.hint.trim();
        const showHint = hint && hint !== item.answer.trim();
        return paragraph(
          showHint ? `${item.blanked}（${hint}）` : item.blanked,
        );
      }),
    ],
  };
}

export function emptyClassroomDoc(): TiptapDoc {
  return seedClassroomDocFromCloze([]);
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

export function extractImageNodes(
  doc: TiptapDoc | null | undefined,
): TiptapNode[] {
  if (!doc?.content?.length) return [];
  const images: TiptapNode[] = [];
  const walk = (node: TiptapNode) => {
    if (node.type === "image") {
      images.push(node);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of doc.content) walk(node);
  return images;
}

export function appendImageNodes(
  doc: TiptapDoc,
  images: TiptapNode[],
): TiptapDoc {
  if (images.length === 0) return doc;
  const seen = new Set(
    extractImageNodes(doc)
      .map((n) => String(n.attrs?.src ?? ""))
      .filter(Boolean),
  );
  const extra = images.filter((n) => {
    const src = String(n.attrs?.src ?? "");
    if (!src || seen.has(src)) return false;
    seen.add(src);
    return true;
  });
  if (extra.length === 0) return doc;
  return { type: "doc", content: [...doc.content, ...extra] };
}

/** True when the board has real lesson text, not just section headings / images. */
export function hasClassroomBodyText(
  doc: TiptapDoc | null | undefined,
): boolean {
  const plain = tiptapDocToPlainText(doc);
  if (!plain) return false;
  return plain
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .some((line) => line.length > 0 && !PREP_SECTION_TITLES.has(line));
}

function headingTexts(doc: TiptapDoc): string[] {
  const titles: string[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== "heading") continue;
    const text = (node.content ?? [])
      .map((child) => child.text ?? "")
      .join("")
      .trim();
    if (text) titles.push(text);
  }
  return titles;
}

function isLegacyPrepBoard(doc: TiptapDoc | null | undefined): boolean {
  if (!doc) return false;
  const titles = new Set(headingTexts(doc));
  return titles.has("Warmup") && titles.has("New focus");
}

/**
 * Shared board is this lesson's cloze only.
 * Teacher-only prep sections are never written onto the student-visible board.
 */
export function bindClassroomDocToPrep(
  existing: TiptapDoc | null | undefined,
  cloze: VocabRecallItem[] | null | undefined,
): { doc: TiptapDoc; changed: boolean } {
  const seeded = seedClassroomDocFromCloze(cloze);
  if (!existing) {
    return { doc: seeded, changed: true };
  }
  if (hasClassroomBodyText(existing) && !isLegacyPrepBoard(existing)) {
    return { doc: existing, changed: false };
  }
  const doc = appendImageNodes(seeded, extractImageNodes(existing));
  return {
    doc,
    changed: serializeClassroomDoc(existing) !== serializeClassroomDoc(doc),
  };
}

/** Keep live image pastes, but never let an empty/legacy board wipe cloze. */
export function mergeClassroomBoardSave(
  incoming: TiptapDoc,
  stored: TiptapDoc | null | undefined,
  cloze: VocabRecallItem[] | null | undefined,
): TiptapDoc {
  if (hasClassroomBodyText(incoming) && !isLegacyPrepBoard(incoming)) {
    return incoming;
  }
  const bound = bindClassroomDocToPrep(stored, cloze);
  return appendImageNodes(bound.doc, extractImageNodes(incoming));
}
