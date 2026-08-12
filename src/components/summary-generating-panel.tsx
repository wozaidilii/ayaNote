"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function SummaryGeneratingPanel({
  lessonId,
  readyHref,
  labels,
}: {
  lessonId: string;
  /** Where to go when summary is ready. Defaults to teacher Lesson Room. */
  readyHref?: string;
  labels: {
    generatingTitle: string;
    generatingBody: string;
    generatingFailed: string;
  };
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");
  const [statusLabel, setStatusLabel] = useState("");
  const doneHref = readyHref ?? `/lessons/${lessonId}?ok=summary`;
  const failHref = readyHref
    ? readyHref.replace(/\?.*$/, "")
    : `/lessons/${lessonId}`;

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    // ~20 min at 2s — long lessons need chunked STT + map-reduce summarize
    const maxAttempts = 600;

    const tick = async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/lessons/${lessonId}/summary-status`, {
          cache: "no-store",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as {
          ready?: boolean;
          failed?: boolean;
          processingStatus?: string;
          processingError?: string;
        };
        if (cancelled) return true;
        if (data.processingStatus) {
          setStatusLabel(data.processingStatus);
        }
        if (data.failed) {
          setFailed(true);
          setErrorDetail(data.processingError || "");
          router.replace(failHref);
          router.refresh();
          return true;
        }
        if (data.ready) {
          router.replace(doneHref);
          router.refresh();
          return true;
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= maxAttempts) {
        if (!cancelled) {
          setFailed(true);
          setErrorDetail("timed_out");
          router.replace(failHref);
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
  }, [doneHref, failHref, lessonId, router]);

  return (
    <div className="panel summary-generating" aria-live="polite">
      <h2 style={{ marginTop: 0 }}>{labels.generatingTitle}</h2>
      {failed ? (
        <>
          <p className="muted">{labels.generatingFailed}</p>
          {errorDetail ? (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {errorDetail}
            </p>
          ) : null}
        </>
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
            {statusLabel ? ` (${statusLabel})` : ""}
          </p>
        </>
      )}
    </div>
  );
}
