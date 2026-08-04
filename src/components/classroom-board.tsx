"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ClassroomBoardState = {
  warmup: string;
  review: string;
  newFocus: string;
  practice: string;
  homeworkSeed: string;
  classroomNotes: string;
  prepUpdatedAt: string | null;
  notesUpdatedAt: string;
  lessonUpdatedAt: string;
};

type Labels = {
  planTitle: string;
  notesTitle: string;
  warmup: string;
  review: string;
  newFocus: string;
  practice: string;
  homework: string;
  notesHint: string;
  saving: string;
  saved: string;
  peerUpdated: string;
  saveError: string;
};

const FIELDS = [
  "warmup",
  "review",
  "newFocus",
  "practice",
  "homeworkSeed",
  "classroomNotes",
] as const;

type FieldKey = (typeof FIELDS)[number];

export function ClassroomBoard({
  lessonId,
  initial,
  labels,
}: {
  lessonId: string;
  initial: ClassroomBoardState;
  labels: Labels;
}) {
  const [state, setState] = useState<ClassroomBoardState>(initial);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "peer" | "error"
  >("idle");
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const latestRef = useRef(state);
  latestRef.current = state;

  const save = useCallback(async () => {
    if (!dirtyRef.current) return;
    setStatus("saving");
    const payload = latestRef.current;
    try {
      const res = await fetch(`/api/lessons/${lessonId}/board`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const next = (await res.json()) as ClassroomBoardState;
      dirtyRef.current = false;
      setState((prev) => ({
        ...prev,
        prepUpdatedAt: next.prepUpdatedAt,
        notesUpdatedAt: next.notesUpdatedAt,
        lessonUpdatedAt: next.lessonUpdatedAt,
      }));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [lessonId]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void save();
    }, 900);
  }, [save]);

  const onChange = (key: FieldKey, value: string) => {
    setState((prev) => ({ ...prev, [key]: value }));
    scheduleSave();
  };

  // Poll for peer edits when local is clean
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (dirtyRef.current) return;
      try {
        const res = await fetch(`/api/lessons/${lessonId}/board`);
        if (!res.ok) return;
        const remote = (await res.json()) as ClassroomBoardState;
        const local = latestRef.current;
        const remoteTs = Math.max(
          remote.prepUpdatedAt ? Date.parse(remote.prepUpdatedAt) : 0,
          Date.parse(remote.lessonUpdatedAt),
        );
        const localTs = Math.max(
          local.prepUpdatedAt ? Date.parse(local.prepUpdatedAt) : 0,
          Date.parse(local.lessonUpdatedAt),
        );
        if (remoteTs <= localTs) return;
        const changed = FIELDS.some((k) => remote[k] !== local[k]);
        if (!changed) {
          setState((prev) => ({
            ...prev,
            prepUpdatedAt: remote.prepUpdatedAt,
            notesUpdatedAt: remote.notesUpdatedAt,
            lessonUpdatedAt: remote.lessonUpdatedAt,
          }));
          return;
        }
        setState(remote);
        setStatus("peer");
      } catch {
        /* ignore poll errors */
      }
    }, 3500);
    return () => window.clearInterval(id);
  }, [lessonId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (dirtyRef.current) void save();
    };
  }, [save]);

  const statusLabel =
    status === "saving"
      ? labels.saving
      : status === "saved"
        ? labels.saved
        : status === "peer"
          ? labels.peerUpdated
          : status === "error"
            ? labels.saveError
            : null;

  return (
    <div className="classroom-board">
      <div className="classroom-board-head">
        <h2 style={{ margin: 0 }}>{labels.planTitle}</h2>
        {statusLabel && (
          <span className={`chip ${status === "error" ? "" : "sky"}`}>
            {statusLabel}
          </span>
        )}
      </div>

      {(
        [
          ["warmup", labels.warmup],
          ["review", labels.review],
          ["newFocus", labels.newFocus],
          ["practice", labels.practice],
          ["homeworkSeed", labels.homework],
        ] as const
      ).map(([key, label]) => (
        <div className="field" key={key}>
          <label htmlFor={`cb-${key}`}>{label}</label>
          <textarea
            id={`cb-${key}`}
            rows={key === "practice" || key === "newFocus" ? 5 : 3}
            value={state[key]}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </div>
      ))}

      <h3 style={{ marginTop: "1.2rem" }}>{labels.notesTitle}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {labels.notesHint}
      </p>
      <div className="field">
        <label htmlFor="cb-notes">{labels.notesTitle}</label>
        <textarea
          id="cb-notes"
          rows={8}
          value={state.classroomNotes}
          onChange={(e) => onChange("classroomNotes", e.target.value)}
        />
      </div>
    </div>
  );
}
