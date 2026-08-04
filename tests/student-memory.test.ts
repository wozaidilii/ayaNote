import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveStrengths,
  isHeuristicSummaryNotes,
  mergeStringLists,
  normalizeMemoryKey,
  planGrammarMerge,
  planVocabMerge,
} from "../src/lib/student-memory.ts";

describe("student-memory", () => {
  it("normalizes keys for dedup", () => {
    assert.equal(normalizeMemoryKey("  敬語  "), "敬語");
    assert.equal(normalizeMemoryKey("Hello  World"), "hello world");
  });

  it("plans vocab creates without duplicating existing terms", () => {
    const ops = planVocabMerge(
      [
        { term: "会議", reading: "かいぎ", meaning: "meeting" },
        { term: "会議", reading: "かいぎ", meaning: "meeting" },
        { term: "資料", meaning: "materials" },
      ],
      [{ id: "v1", term: "会議", reading: "", meaning: "" }],
    );

    assert.equal(ops.length, 2);
    assert.deepEqual(ops[0], {
      action: "update",
      id: "v1",
      reading: "かいぎ",
      meaning: "meeting",
    });
    assert.deepEqual(ops[1], {
      action: "create",
      term: "資料",
      reading: "",
      meaning: "materials",
    });
  });

  it("plans grammar creates and fills empty notes", () => {
    const ops = planGrammarMerge(
      [
        { pattern: "〜ていただけますか", notes: "polite request" },
        { pattern: "〜ていただけますか", notes: "dup" },
      ],
      [{ id: "g1", pattern: "〜ていただけますか", notes: "" }],
    );
    assert.equal(ops.length, 1);
    assert.deepEqual(ops[0], {
      action: "update",
      id: "g1",
      notes: "polite request",
    });
  });

  it("derives strengths from topics excluding mistake echoes", () => {
    const strengths = deriveStrengths(
      ["ビジネスメール", "敬語", "雑談"],
      ["敬語の誤り：「です」→「でございます」"],
    );
    assert.deepEqual(strengths, ["ビジネスメール", "雑談"]);
  });

  it("merges string lists with limit and dedup", () => {
    assert.deepEqual(mergeStringLists(["A", "b"], ["B", "C", "a"], 3), ["A", "b", "C"]);
  });

  it("detects heuristic summary notes", () => {
    assert.equal(isHeuristicSummaryNotes("Generated locally without an AI API key."), true);
    assert.equal(isHeuristicSummaryNotes("Summarized via deepseek."), false);
  });
});
