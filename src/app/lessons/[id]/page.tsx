import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import {
  approveSummary,
  importTranscriptAndSummarize,
  updateLessonStatus,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { BookOpen, NotebookPen, Video, UiIcon } from "@/components/icons";
import { SummaryGeneratingPanel } from "@/components/summary-generating-panel";
import { PageHeading } from "@/components/ui-heading";
import { courseTypeLabel, getAiProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import { isHeuristicSummaryNotes } from "@/lib/student-memory";
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

type VocabRow = { term: string; reading?: string; meaning?: string };
type GrammarRow = { pattern: string; notes?: string };
type ExampleRow = { pattern: string; examples: string[] };

function parseObjectArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
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
  const heuristic = isHeuristicSummaryNotes(lesson.summary?.notes);

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

      <div
        style={{
          marginTop: "0.8rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          alignItems: "center",
        }}
      >
        <span className="chip">{t(statusKey)}</span>
        <span className="chip sky">
          {courseTypeLabel(lesson.student.courseType)}
        </span>
        <span className={`chip ${lesson.status === "completed" ? "done" : "soon"}`}>
          {t("lessonStatus")}: {lesson.status}
        </span>
        <span className="chip">
          {hasAiKey ? t("aiReady", { provider }) : t("aiMissing", { provider })}
        </span>
        {heuristic && <span className="chip">{t("heuristicBadge")}</span>}
        <a
          className="btn"
          href={`/classroom/${lesson.id}`}
          target="_blank"
          rel="noreferrer"
        >
          <UiIcon icon={Video} size={15} />
          {t("openClassroomTab")}
        </a>
        <Link className="btn secondary" href={`/prep?lesson=${lesson.id}`}>
          <UiIcon icon={NotebookPen} size={15} />
          {t("openPrep")}
        </Link>
      </div>

      <div className="panel" style={{ marginTop: "0.85rem" }}>
        <h2 style={{ margin: 0 }}>{t("pipelineTitle")}</h2>
        <p className="muted" style={{ marginTop: "0.4rem" }}>
          {t("pipelineHint")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <form action={updateLessonStatus}>
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="status" value="in_progress" />
            <button
              className="btn secondary sm"
              type="submit"
              disabled={lesson.status === "in_progress"}
            >
              {t("markInProgress")}
            </button>
          </form>
          <form action={updateLessonStatus}>
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="status" value="completed" />
            <button
              className="btn secondary sm"
              type="submit"
              disabled={lesson.status === "completed"}
            >
              {t("markComplete")}
            </button>
          </form>
        </div>
      </div>

      {sp.ok === "summary" && <p className="chip done">{t("okSummary")}</p>}
      {sp.ok === "approved" && <p className="chip done">{t("okApproved")}</p>}
      {sp.ok === "status" && <p className="chip done">{t("okStatus")}</p>}
      {summarizing && <p className="chip soon">{t("summarizingChip")}</p>}
      {sp.ok === "livekit" && <p className="chip done">{t("okLivekit")}</p>}
      {sp.warn === "no_ai_key" && <p className="chip">{t("warnNoAiKey")}</p>}
      {sp.err === "empty_transcript" && <p className="chip">{t("errEmpty")}</p>}

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div>
          {summarizing ? (
            <SummaryGeneratingPanel
              lessonId={lesson.id}
              labels={{
                generatingTitle: t("generatingTitle"),
                generatingBody: t("generatingBody"),
                generatingFailed: t("generatingFailed"),
              }}
            />
          ) : null}

          {!summarizing && (
            <form className="panel" action={importTranscriptAndSummarize}>
              <input type="hidden" name="lessonId" value={lesson.id} />
              <h2 style={{ marginTop: 0 }}>{t("pasteTitle")}</h2>
              <p className="muted">{t("manualFallback")}</p>
              {lesson.summary && <p className="chip">{t("regenNote")}</p>}
              <div className="field">
                <label htmlFor="transcript">{t("paste")}</label>
                <textarea
                  id="transcript"
                  name="transcript"
                  placeholder={t("placeholder")}
                  defaultValue={
                    lesson.transcript?.editedText ||
                    lesson.transcript?.rawText ||
                    ""
                  }
                  required
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
          )}

          {!summarizing && lesson.summary && (
            <form className="panel" action={approveSummary}>
              <input type="hidden" name="lessonId" value={lesson.id} />

              <h2 style={{ marginTop: 0 }}>{t("todayContent")}</h2>
              {heuristic && <p className="chip">{t("heuristicWarn")}</p>}
              <div className="field">
                <label htmlFor="todaySummary">{t("todaySummary")}</label>
                <textarea
                  id="todaySummary"
                  name="todaySummary"
                  rows={5}
                  defaultValue={lesson.summary.todaySummary}
                />
              </div>
              <p>
                <strong>{common("topics")}:</strong> {topics.join(" · ") || "—"}
              </p>

              <h3>{t("priorReview")}</h3>
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
                <label htmlFor="homework">{common("homework")}</label>
                <textarea
                  id="homework"
                  name="homework"
                  defaultValue={lesson.summary.homework}
                />
              </div>
              <div className="field">
                <label htmlFor="nextFocus">{common("nextFocus")}</label>
                <textarea
                  id="nextFocus"
                  name="nextFocus"
                  defaultValue={lesson.summary.nextFocus}
                />
              </div>
              <div className="field">
                <label htmlFor="notes">{t("notes")}</label>
                <textarea
                  id="notes"
                  name="notes"
                  defaultValue={lesson.summary.notes}
                />
              </div>
              <button className="btn" type="submit">
                {t("saveSummary")}
              </button>
              {lesson.summary.approved && (
                <p className="muted" style={{ marginTop: "0.75rem" }}>
                  {t("approvedNote")}
                </p>
              )}
            </form>
          )}
        </div>

        <aside className="panel">
          <h2 style={{ marginTop: 0 }}>{t("sidebar")}</h2>
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
            <strong>{common("nextFocus")}:</strong> {lastFocus || "—"}
          </p>
          <p>
            <strong>{common("strengths")}:</strong>{" "}
            {parseJsonArray(lesson.student.progress?.strengthsJson).join(" · ") || "—"}
          </p>
          <p>
            <strong>{common("weaknesses")}:</strong>{" "}
            {parseJsonArray(lesson.student.progress?.weaknessesJson).join(
              " · ",
            ) || "—"}
          </p>
          <h3>{common("vocab")}</h3>
          <ul>
            {lesson.student.vocabItems.map((v) => (
              <li key={v.id}>{v.term}</li>
            ))}
          </ul>
          {lesson.prepDraft && (
            <div style={{ marginTop: "1rem" }}>
              <h3>{t("prepSidebar")}</h3>
              <p className="muted">{lesson.prepDraft.newFocus || "—"}</p>
              <Link className="btn secondary sm" href={`/prep?lesson=${lesson.id}`}>
                {t("openPrep")}
              </Link>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
