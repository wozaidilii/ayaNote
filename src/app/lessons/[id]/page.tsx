import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { approveSummary, importTranscriptAndSummarize } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { BookOpen, Video, UiIcon } from "@/components/icons";
import { SummaryGeneratingPanel } from "@/components/summary-generating-panel";
import { PageHeading } from "@/components/ui-heading";
import { courseTypeLabel, getAiProvider } from "@/lib/ai";
import { parseClassroomDoc, tiptapDocToPlainText } from "@/lib/classroom-doc";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

const TRANSCRIPT_STATUS_KEY: Record<
  string,
  "statusNone" | "statusWaiting" | "statusImported" | "statusManual"
> = {
  none: "statusNone",
  waiting_drive: "statusWaiting",
  imported: "statusImported",
  manual: "statusManual",
};

const SOURCE_KEY: Record<
  string,
  | "sourceLivekit"
  | "sourceManual"
  | "sourceDrive"
  | "sourceUpload"
  | "sourceMeet"
> = {
  livekit: "sourceLivekit",
  manual: "sourceManual",
  meet_import: "sourceManual",
  drive_import: "sourceDrive",
  upload: "sourceUpload",
};

type VocabRow = { term: string; reading?: string; meaning?: string };
type GrammarRow = { pattern: string; notes?: string };
type ExampleRow = { pattern: string; examples: string[] };
type RoomPhase = "needsClass" | "generating" | "review" | "approved";

function parseObjectArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function truncateText(text: string, max = 280) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

export default async function LessonRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    ok?: string;
    err?: string;
    warn?: string;
    file?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const teacher = await requireTeacher();
  const t = await getTranslations("lessonRoom");
  const common = await getTranslations("common");

  const lesson = await prisma.lesson.findUnique({
    where: { id },
    include: {
      student: {
        include: {
          progress: true,
          vocabItems: { take: 8, orderBy: { createdAt: "desc" } },
          lessons: {
            where: { status: "completed" },
            include: { summary: true },
            orderBy: { startsAt: "desc" },
            take: 1,
          },
        },
      },
      teacher: true,
      transcript: true,
      summary: true,
      prepDraft: true,
    },
  });
  if (!lesson) notFound();
  if (lesson.teacherId !== teacher.id) redirect("/today");

  const lastFocus = lesson.student.lessons[0]?.summary?.nextFocus;
  const topics = lesson.summary
    ? parseJsonArray(lesson.summary.topicsJson)
    : [];
  const mistakes = lesson.summary
    ? parseJsonArray(lesson.summary.mistakesJson)
    : [];
  const vocab = lesson.summary
    ? parseObjectArray<VocabRow>(lesson.summary.vocabJson)
    : [];
  const grammar = lesson.summary
    ? parseObjectArray<GrammarRow>(lesson.summary.grammarJson)
    : [];
  const examples = lesson.summary
    ? parseObjectArray<ExampleRow>(lesson.summary.examplesJson)
    : [];
  const statusKey =
    TRANSCRIPT_STATUS_KEY[lesson.transcriptStatus] ?? "statusNone";
  const provider = getAiProvider();
  const hasAiKey =
    provider === "deepseek"
      ? Boolean(process.env.DEEPSEEK_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY);
  const summarizing = sp.ok === "summarizing" && !lesson.summary;

  const phase: RoomPhase = summarizing
    ? "generating"
    : lesson.summary?.approved
      ? "approved"
      : lesson.summary
        ? "review"
        : "needsClass";

  const boardPlain = tiptapDocToPlainText(
    parseClassroomDoc(lesson.classroomDoc),
  );
  const boardPreview = boardPlain ? truncateText(boardPlain) : "";
  const transcriptSource = lesson.transcript?.source
    ? (SOURCE_KEY[lesson.transcript.source] ?? "sourceMeet")
    : null;
  const highlightTopics = topics.slice(0, 8);
  const highlightVocab = vocab.slice(0, 3);
  const highlightGrammar = grammar.slice(0, 3);

  const flowSteps: Array<{
    key: "stepClassroom" | "stepTranscript" | "stepSummary" | "stepApprove";
    active: boolean;
    done: boolean;
  }> = [
    {
      key: "stepClassroom",
      active: phase === "needsClass",
      done: phase !== "needsClass",
    },
    {
      key: "stepTranscript",
      active: phase === "generating",
      done:
        Boolean(lesson.transcript) ||
        phase === "review" ||
        phase === "approved",
    },
    {
      key: "stepSummary",
      active: phase === "review",
      done: phase === "approved" || Boolean(lesson.summary),
    },
    {
      key: "stepApprove",
      active: phase === "approved",
      done: phase === "approved",
    },
  ];

  const pasteForm = (
    <form action={importTranscriptAndSummarize}>
      <input type="hidden" name="lessonId" value={lesson.id} />
      <p className="muted" style={{ marginTop: 0 }}>
        {t("manualFallback")}
      </p>
      {lesson.summary && <p className="chip">{t("regenNote")}</p>}
      <div className="field">
        <label htmlFor="transcript">{t("paste")}</label>
        <textarea
          id="transcript"
          name="transcript"
          placeholder={t("placeholder")}
          defaultValue={
            lesson.transcript?.editedText || lesson.transcript?.rawText || ""
          }
          required
          rows={8}
        />
      </div>
      <div className="field">
        <label htmlFor="tags">{t("tags")}</label>
        <input
          id="tags"
          name="tags"
          placeholder="て形, keigo, travel"
          defaultValue={parseJsonArray(lesson.tagsJson).join(", ")}
        />
      </div>
      <button className="btn" type="submit">
        {lesson.summary
          ? t("regenerateSummary")
          : `${common("import")} / ${common("generate")}`}
      </button>
    </form>
  );

  return (
    <AppShell active="today" personName={teacher.name}>
      <PageHeading
        icon={BookOpen}
        title={t("title")}
        subtitle={
          <>
            {lesson.student.name} ·{" "}
            {formatInTz(
              lesson.startsAt,
              "yyyy-MM-dd HH:mm",
              normalizeTimezone(lesson.teacher.timezone),
            )}{" "}
            · {t("subtitle")}
          </>
        }
      />

      <div className="lesson-room-flow" aria-label={t("flowLabel")}>
        {flowSteps.map((step, i) => (
          <span key={step.key} className="lesson-room-flow-item">
            {i > 0 && <span className="lesson-room-flow-sep" aria-hidden />}
            <span
              className={`chip${step.active ? " sky" : ""}${step.done && !step.active ? " done" : ""}`}
            >
              {t(step.key)}
            </span>
          </span>
        ))}
      </div>

      <div className="lesson-room-meta">
        <span className="chip">{t(statusKey)}</span>
        <span className="chip sky">
          {courseTypeLabel(lesson.student.courseType)}
        </span>
        <span className="chip">
          {hasAiKey ? t("aiReady", { provider }) : t("aiMissing", { provider })}
        </span>
        {transcriptSource && (
          <span className="chip">{t(transcriptSource)}</span>
        )}
        {phase === "approved" && (
          <span className="chip done">{t("approvedChip")}</span>
        )}
      </div>

      {sp.ok === "summary" && <p className="chip done">{t("okSummary")}</p>}
      {summarizing && <p className="chip soon">{t("summarizingChip")}</p>}
      {sp.ok === "livekit" && <p className="chip done">{t("okLivekit")}</p>}
      {sp.warn === "no_ai_key" && <p className="chip">{t("warnNoAiKey")}</p>}
      {sp.err === "empty_transcript" && <p className="chip">{t("errEmpty")}</p>}

      <div className="grid-2 lesson-room-grid">
        <div className="lesson-room-main">
          {phase === "generating" && (
            <SummaryGeneratingPanel
              lessonId={lesson.id}
              labels={{
                generatingTitle: t("generatingTitle"),
                generatingBody: t("generatingBody"),
                generatingFailed: t("generatingFailed"),
              }}
            />
          )}

          {phase === "needsClass" && (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>{t("startClassTitle")}</h2>
              <p className="muted">{t("classroomHint")}</p>
              <a
                className="btn"
                href={`/classroom/${lesson.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <UiIcon icon={Video} size={15} />
                {t("openClassroomTab")}
              </a>
              {lesson.prepDraft && (
                <div className="lesson-room-prep-peek">
                  <h3>{t("prepPeek")}</h3>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {lesson.prepDraft.newFocus || t("prepEmpty")}
                  </p>
                </div>
              )}
              <details className="lesson-room-details">
                <summary>{t("pasteTitle")}</summary>
                {pasteForm}
              </details>
            </div>
          )}

          {(phase === "review" || phase === "approved") && lesson.summary && (
            <form className="panel" action={approveSummary}>
              <input type="hidden" name="lessonId" value={lesson.id} />

              <section className="lesson-room-block">
                <h2 style={{ marginTop: 0 }}>{t("highlights")}</h2>
                {highlightTopics.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <div className="lesson-room-highlights">
                    {highlightTopics.map((topic, i) => (
                      <span key={`${topic}-${i}`} className="chip sky">
                        {topic}
                      </span>
                    ))}
                  </div>
                )}
                {(highlightVocab.length > 0 || highlightGrammar.length > 0) && (
                  <p className="lesson-room-key-points muted">
                    {highlightVocab.length > 0 && (
                      <>
                        <strong>{common("vocab")}:</strong>{" "}
                        {highlightVocab.map((v) => v.term).join(" · ")}
                      </>
                    )}
                    {highlightVocab.length > 0 && highlightGrammar.length > 0
                      ? " · "
                      : null}
                    {highlightGrammar.length > 0 && (
                      <>
                        <strong>{common("grammar")}:</strong>{" "}
                        {highlightGrammar.map((g) => g.pattern).join(" · ")}
                      </>
                    )}
                  </p>
                )}
              </section>

              <section className="lesson-room-block">
                <h2>{t("todaySummaryShort")}</h2>
                <p className="muted lesson-room-hint">
                  {t("todaySummaryHint")}
                </p>
                <div className="field">
                  <label htmlFor="todaySummary" className="sr-only">
                    {t("todaySummaryShort")}
                  </label>
                  <textarea
                    id="todaySummary"
                    name="todaySummary"
                    rows={4}
                    defaultValue={lesson.summary.todaySummary}
                  />
                </div>
              </section>

              <section className="lesson-room-block lesson-room-next">
                <h2>{t("nextDirection")}</h2>
                <p className="muted lesson-room-hint">
                  {t("nextDirectionHint")}
                </p>
                <div className="field">
                  <label htmlFor="nextFocus">{t("nextFocusLabel")}</label>
                  <textarea
                    id="nextFocus"
                    name="nextFocus"
                    rows={4}
                    defaultValue={lesson.summary.nextFocus}
                  />
                </div>
                <div className="field">
                  <label htmlFor="homework">{common("homework")}</label>
                  <textarea
                    id="homework"
                    name="homework"
                    rows={3}
                    defaultValue={lesson.summary.homework}
                  />
                </div>
              </section>

              <details className="lesson-room-details">
                <summary>{t("detailsToggle")}</summary>
                <div className="field">
                  <label htmlFor="priorReview">{t("priorReview")}</label>
                  <textarea
                    id="priorReview"
                    name="priorReview"
                    rows={3}
                    defaultValue={lesson.summary.priorReview}
                  />
                </div>

                <h3>{common("vocab")}</h3>
                {vocab.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <ul>
                    {vocab.map((v, i) => (
                      <li key={`${v.term}-${i}`}>
                        <strong>{v.term}</strong>
                        {v.reading ? ` (${v.reading})` : ""}
                        {v.meaning ? ` — ${v.meaning}` : ""}
                      </li>
                    ))}
                  </ul>
                )}

                <h3>{common("grammar")}</h3>
                {grammar.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <ul>
                    {grammar.map((g, i) => (
                      <li key={`${g.pattern}-${i}`}>
                        <strong>{g.pattern}</strong>
                        {g.notes ? ` — ${g.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                )}

                <h3>{t("examples")}</h3>
                {examples.length === 0 ? (
                  <p className="muted">{t("noExamples")}</p>
                ) : (
                  examples.map((ex, i) => (
                    <div
                      key={`${ex.pattern}-${i}`}
                      style={{ marginBottom: "0.85rem" }}
                    >
                      <div style={{ fontWeight: 650 }}>{ex.pattern}</div>
                      <ul style={{ margin: "0.35rem 0 0" }}>
                        {(ex.examples ?? []).map((line, j) => (
                          <li key={j}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}

                <h3>{common("mistakes")}</h3>
                {mistakes.length === 0 ? (
                  <p className="muted">—</p>
                ) : (
                  <ul>
                    {mistakes.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}

                <div className="field">
                  <label htmlFor="notes">{t("notes")}</label>
                  <textarea
                    id="notes"
                    name="notes"
                    defaultValue={lesson.summary.notes}
                  />
                </div>
              </details>

              <div className="lesson-room-actions">
                <button className="btn" type="submit">
                  {t("saveSummary")}
                </button>
                {lesson.summary.approved && (
                  <span className="chip done">{t("approvedChip")}</span>
                )}
              </div>

              {phase === "approved" && (
                <div className="lesson-room-next-links">
                  <a
                    className="btn ghost"
                    href={`/students/${lesson.studentId}`}
                  >
                    {t("goStudent")}
                  </a>
                  <a className="btn ghost" href={`/prep?lesson=${lesson.id}`}>
                    {t("goPrep")}
                  </a>
                </div>
              )}
            </form>
          )}

          {(phase === "review" || phase === "approved") && (
            <details className="panel lesson-room-details">
              <summary>{t("pasteTitle")}</summary>
              {pasteForm}
            </details>
          )}

          {phase === "generating" && (
            <details className="panel lesson-room-details">
              <summary>{t("pasteTitle")}</summary>
              {pasteForm}
            </details>
          )}
        </div>

        <aside className="panel">
          <h2 style={{ marginTop: 0 }}>{t("sidebarLesson")}</h2>
          <p>
            <strong>{common("course")}:</strong>{" "}
            {courseTypeLabel(lesson.student.courseType)}
          </p>
          <p>
            <strong>{common("level")}:</strong> {lesson.student.level}
          </p>
          <p>
            <strong>{common("goals")}:</strong> {lesson.student.goals || "—"}
          </p>
          <p>
            <strong>{t("sourceLabel")}:</strong>{" "}
            {transcriptSource ? t(transcriptSource) : t("statusNone")}
          </p>
          <p>
            <strong>{t("lastFocusLabel")}:</strong> {lastFocus || "—"}
          </p>
          <p>
            <strong>{common("weaknesses")}:</strong>{" "}
            {parseJsonArray(lesson.student.progress?.weaknessesJson).join(
              " · ",
            ) || "—"}
          </p>

          <h3>{t("prepPeek")}</h3>
          {lesson.prepDraft ? (
            <>
              <p className="muted">
                {lesson.prepDraft.newFocus || t("prepEmpty")}
              </p>
              <a className="btn ghost sm" href={`/prep?lesson=${lesson.id}`}>
                {t("openPrep")}
              </a>
            </>
          ) : (
            <p className="muted">{t("prepNone")}</p>
          )}

          <h3>{t("boardPeek")}</h3>
          {boardPreview ? (
            <>
              <p className="muted lesson-room-board-preview">{boardPreview}</p>
              <a
                className="btn ghost sm"
                href={`/classroom/${lesson.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <UiIcon icon={Video} size={14} />
                {t("openBoard")}
              </a>
            </>
          ) : (
            <>
              <p className="muted">{t("boardEmpty")}</p>
              {phase !== "approved" && (
                <a
                  className="btn ghost sm"
                  href={`/classroom/${lesson.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <UiIcon icon={Video} size={14} />
                  {t("openClassroomTab")}
                </a>
              )}
            </>
          )}

          {lesson.student.vocabItems.length > 0 && (
            <>
              <h3>{common("vocab")}</h3>
              <ul>
                {lesson.student.vocabItems.map((v) => (
                  <li key={v.id}>{v.term}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
