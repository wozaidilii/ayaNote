"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function SummaryGeneratingPanel({
  lessonId,
  labels,
}: {
  lessonId: string;
  labels: {
    generatingTitle: string;
    generatingBody: string;
    generatingFailed: string;
  };
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 90; // ~3 min at 2s

    const tick = async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/lessons/${lessonId}/summary-status`, {
          cache: "no-store",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { ready?: boolean };
        if (cancelled) return true;
        if (data.ready) {
          router.replace(`/lessons/${lessonId}?ok=summary`);
          router.refresh();
          return true;
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= maxAttempts) {
        if (!cancelled) {
          setFailed(true);
          router.replace(`/lessons/${lessonId}`);
          router.refresh();
        }
        return true;
      }
      return false;
    };

    let timer: number | undefined;
    const loop = async () => {
      const done = await tick();
      if (!done && !cancelled) {
        timer = window.setTimeout(loop, 2000);
      }
    };
    void loop();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [lessonId, router]);

  return (
    <div className="panel summary-generating" aria-live="polite">
      <h2 style={{ marginTop: 0 }}>{labels.generatingTitle}</h2>
      {failed ? (
        <p className="muted">{labels.generatingFailed}</p>
      ) : (
        <>
          <div className="summary-generating-skel" aria-hidden>
            <div className="prep-skeleton-line" style={{ width: "92%" }} />
            <div className="prep-skeleton-line" style={{ width: "78%" }} />
            <div className="prep-skeleton-line" style={{ width: "86%" }} />
            <div className="prep-skeleton-line" style={{ width: "64%" }} />
            <div className="prep-skeleton-line" style={{ width: "88%" }} />
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            {labels.generatingBody}
          </p>
        </>
      )}
    </div>
  );
}
