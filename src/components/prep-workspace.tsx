"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateLessonPrep,
  generateMissingPrepBatch,
  savePrepDraft,
} from "@/app/actions";

export type PrepLessonItem = {
  id: string;
  studentId: string;
  studentName: string;
  courseLabel: string;
  level: string;
  startsAtLabel: string;
  prepStatus: string;
  lastFocus: string;
  draft: {
    warmup: string;
    review: string;
    newFocus: string;
    practice: string;
    homeworkSeed: string;
  };
};

const SECTIONS = [
  { key: "warmup", labelKey: "sectionWarmup" },
  { key: "review", labelKey: "sectionReview" },
  { key: "newFocus", labelKey: "sectionNewFocus" },
  { key: "practice", labelKey: "sectionPractice" },
  { key: "homeworkSeed", labelKey: "sectionHomework" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
type DraftFields = PrepLessonItem["draft"];

function hasDraftContent(draft: DraftFields) {
  return Boolean(
    draft.warmup.trim() ||
      draft.review.trim() ||
      draft.newFocus.trim() ||
      draft.practice.trim() ||
      draft.homeworkSeed.trim(),
  );
}

function missingDraftIds(
  lessons: PrepLessonItem[],
  drafts: Record<string, DraftFields>,
) {
  return lessons
    .filter((l) => !hasDraftContent(drafts[l.id] ?? l.draft))
    .map((l) => l.id);
}

export function PrepWorkspace({
  lessons,
  labels,
}: {
  lessons: PrepLessonItem[];
  labels: {
    queue: string;
    empty: string;
    regenerate: string;
    markReady: string;
    saveDraft: string;
    sectionWarmup: string;
    sectionReview: string;
    sectionNewFocus: string;
    sectionPractice: string;
    sectionHomework: string;
    lastFocus: string;
    noDraft: string;
    sections: string;
    generating: string;
    generateMissing: string;
    generateDone: string;
  };
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(lessons[0]?.id ?? "");
  const [section, setSection] = useState<SectionKey>("warmup");
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(lessons.map((l) => [l.id, { ...l.draft }])),
  );
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(lessons.map((l) => [l.id, l.prepStatus])),
  );
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const autoStarted = useRef(false);
  const batchInFlight = useRef(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setDrafts(Object.fromEntries(lessons.map((l) => [l.id, { ...l.draft }])));
    setStatuses(Object.fromEntries(lessons.map((l) => [l.id, l.prepStatus])));
  }, [lessons]);

  useEffect(() => {
    if (selectedId && !lessons.some((l) => l.id === selectedId) && lessons[0]) {
      setSelectedId(lessons[0].id);
    }
  }, [lessons, selectedId]);

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const match = hash.match(/^lesson-(.+)$/);
      if (match && lessons.some((l) => l.id === match[1])) {
        setSelectedId(match[1]);
      }
      const params = new URLSearchParams(window.location.search);
      const q = params.get("lesson");
      if (q && lessons.some((l) => l.id === q)) setSelectedId(q);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [lessons]);

  async function runBatch(ids: string[]) {
    if (ids.length === 0 || batchInFlight.current) return;
    batchInFlight.current = true;
    setBatchRunning(true);
    setBatchTotal(ids.length);
    setBatchDone(0);
    setBatchMessage("");

    let queue = [...ids];
    let completed = 0;

    try {
      while (queue.length > 0) {
        const chunk = queue.slice(0, 4);
        queue = queue.slice(4);
        const result = await generateMissingPrepBatch(chunk);
        for (const item of result.generated) {
          setDrafts((prev) => ({
            ...prev,
            [item.lessonId]: { ...item.draft },
          }));
          setStatuses((prev) => ({ ...prev, [item.lessonId]: "draft" }));
        }
        completed += chunk.length;
        setBatchDone(Math.min(completed, ids.length));
      }
      setBatchMessage(labels.generateDone);
      startTransition(() => router.refresh());
    } catch {
      setBatchMessage(labels.generateDone);
    } finally {
      batchInFlight.current = false;
      setBatchRunning(false);
    }
  }

  useEffect(() => {
    if (autoStarted.current || lessons.length === 0) return;
    const missing = lessons.filter((l) => !hasDraftContent(l.draft)).map((l) => l.id);
    if (missing.length === 0) return;
    autoStarted.current = true;
    void runBatch(missing);
  }, [lessons]);

  const selected = useMemo(
    () => lessons.find((l) => l.id === selectedId) ?? lessons[0],
    [lessons, selectedId],
  );

  const currentDraft = selected ? drafts[selected.id] : null;
  const missingCount = missingDraftIds(lessons, drafts).length;

  function selectLesson(id: string) {
    setSelectedId(id);
    setSection("warmup");
    window.history.replaceState(null, "", `/prep?lesson=${id}#lesson-${id}`);
  }

  function updateField(field: SectionKey, value: string) {
    if (!selected) return;
    setDrafts((prev) => ({
      ...prev,
      [selected.id]: { ...prev[selected.id], [field]: value },
    }));
  }

  if (lessons.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">
          <p>{labels.empty}</p>
        </div>
      </div>
    );
  }

  if (!selected || !currentDraft) return null;

  const sectionLabel = (key: SectionKey) => {
    const map = {
      warmup: labels.sectionWarmup,
      review: labels.sectionReview,
      newFocus: labels.sectionNewFocus,
      practice: labels.sectionPractice,
      homeworkSeed: labels.sectionHomework,
    };
    return map[key];
  };

  return (
    <div className="prep-layout">
      <aside className="prep-queue panel" aria-label={labels.queue}>
        <div className="panel-header">
          <h2>{labels.queue}</h2>
          <span className="chip">{lessons.length}</span>
        </div>

        {(batchRunning || batchMessage || missingCount > 0) && (
          <div className="prep-batch-status">
            {batchRunning ? (
              <p className="muted">
                {labels.generating
                  .replace("{done}", String(batchDone))
                  .replace("{total}", String(batchTotal))}
              </p>
            ) : batchMessage ? (
              <p className="muted">{batchMessage}</p>
            ) : null}
            {!batchRunning && missingCount > 0 && (
              <button
                type="button"
                className="btn secondary sm"
                onClick={() => void runBatch(missingDraftIds(lessons, drafts))}
              >
                {labels.generateMissing.replace("{count}", String(missingCount))}
              </button>
            )}
          </div>
        )}

        <div className="prep-queue-list">
          {lessons.map((lesson) => {
            const active = lesson.id === selected.id;
            const status = statuses[lesson.id] ?? lesson.prepStatus;
            const filling =
              batchRunning &&
              !hasDraftContent(drafts[lesson.id] ?? lesson.draft);
            return (
              <button
                key={lesson.id}
                type="button"
                className="prep-queue-item"
                data-active={active}
                onClick={() => selectLesson(lesson.id)}
              >
                <div className="prep-queue-name">{lesson.studentName}</div>
                <div className="prep-queue-meta">{lesson.startsAtLabel}</div>
                <div className="prep-queue-tags">
                  <span
                    className={`chip ${
                      status === "ready" ? "done" : filling ? "soon" : status === "draft" ? "done" : "soon"
                    }`}
                  >
                    {filling ? "…" : status}
                  </span>
                  <span className="chip">{lesson.courseLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="prep-editor panel" aria-label={selected.studentName}>
        <div className="prep-editor-top">
          <div>
            <h2 className="prep-editor-title">{selected.studentName}</h2>
            <p className="muted">
              {selected.startsAtLabel} · {selected.courseLabel} · {selected.level}
            </p>
            {selected.lastFocus && (
              <p className="prep-last-focus">
                <span className="chip sky">
                  {labels.lastFocus}: {selected.lastFocus}
                </span>
              </p>
            )}
          </div>
          <div className="list-row-actions">
            <form action={generateLessonPrep.bind(null, selected.id)}>
              <button className="btn secondary sm" type="submit" disabled={batchRunning}>
                {labels.regenerate}
              </button>
            </form>
          </div>
        </div>

        <div className="prep-section-tabs" role="tablist" aria-label={labels.sections}>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              className="prep-section-tab"
              data-active={section === s.key}
              aria-selected={section === s.key}
              onClick={() => setSection(s.key)}
            >
              {sectionLabel(s.key)}
            </button>
          ))}
        </div>

        <form action={savePrepDraft} className="prep-section-body">
          <input type="hidden" name="lessonId" value={selected.id} />
          {SECTIONS.map((s) => (
            <input
              key={`hidden-${s.key}`}
              type="hidden"
              name={s.key}
              value={currentDraft[s.key]}
            />
          ))}

          <div className="field">
            <label htmlFor={`prep-${selected.id}-${section}`}>{sectionLabel(section)}</label>
            <textarea
              id={`prep-${selected.id}-${section}`}
              value={currentDraft[section]}
              onChange={(e) => updateField(section, e.target.value)}
              placeholder={
                batchRunning && !hasDraftContent(currentDraft)
                  ? labels.generating
                      .replace("{done}", String(batchDone))
                      .replace("{total}", String(batchTotal))
                  : labels.noDraft
              }
              rows={14}
            />
          </div>

          <div className="prep-editor-actions">
            <button className="btn secondary" name="status" value="draft" type="submit">
              {labels.saveDraft}
            </button>
            <button className="btn" name="status" value="ready" type="submit">
              {labels.markReady}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
