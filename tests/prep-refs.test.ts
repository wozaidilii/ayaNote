import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyPrepRefs,
  hasPrepRefs,
  parsePrepRefs,
  withEditedGeneration,
} from "../src/lib/prep-refs.ts";

describe("prep-refs", () => {
  it("parses past lesson links and generation source", () => {
    const refs = parsePrepRefs(
      JSON.stringify({
        course: "JLPT N4",
        level: "N4",
        goals: "keigo",
        pastLessons: ["old label"],
        pastLessonLinks: [{ id: "les_1", label: "敬語レビュー" }],
        topics: ["メール"],
        weaknesses: [],
        vocab: ["会議"],
        generationSource: "ai",
      }),
    );
    assert.equal(refs.generationSource, "ai");
    assert.deepEqual(refs.pastLessonLinks, [{ id: "les_1", label: "敬語レビュー" }]);
    assert.equal(hasPrepRefs(refs), true);
  });

  it("falls back safely on invalid JSON", () => {
    assert.deepEqual(parsePrepRefs("{nope"), emptyPrepRefs());
  });

  it("marks teacher edits", () => {
    const edited = withEditedGeneration({
      ...emptyPrepRefs(),
      generationSource: "ai",
      course: "Business Japanese",
    });
    assert.equal(edited.generationSource, "edited");
    assert.equal(edited.course, "Business Japanese");
  });
});
