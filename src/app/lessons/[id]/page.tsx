import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  approveSummary,
  fetchDriveTranscriptForLesson,
  importTranscriptAndSummarize,
  updateLessonStatus,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { ClassroomVideo } from "@/components/classroom-video";
import { courseTypeLabel, getAiProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { livekitConfigured } from "@/lib/livekit";
import { sttConfigured } from "@/lib/stt";
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
  const googleConnected = Boolean(
    lesson.teacher.googleConnectedEmail || lesson.teacher.googleRefreshToken,
  );
  const livekitReady = livekitConfigured();
  const sttReady = sttConfigured();

  return (
    <AppShell active="today">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {lesson.student.name} ·{" "}
        {formatInTz(
          lesson.startsAt,
          "yyyy-MM-dd HH:mm",
          normalizeTimezone(lesson.teacher.timezone),
        )}{" "}
        · {t("subtitle")}
      </p>

      <div
        style={{
          marginTop: "0.8rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
        }}
      >
        <span className="chip">{t(statusKey)}</span>
        <span className="chip sky">
          {courseTypeLabel(lesson.student.courseType)}
        </span>
        {lesson.driveFileId && (
          <span className="chip">Drive: {lesson.driveFileId.slice(0, 8)}…</span>
        )}
        <span className="chip">
          {hasAiKey ? t("aiReady", { provider }) : t("aiMissing", { provider })}
        </span>
      </div>

      {sp.ok === "summary" && <p className="chip done">{t("okSummary")}</p>}
      {sp.ok === "livekit" && <p className="chip done">{t("okLivekit")}</p>}
      {sp.ok === "drive" && (
        <p className="chip done">
          {t("okDrive")}
          {sp.file ? ` · ${decodeURIComponent(sp.file)}` : ""}
        </p>
      )}
      {sp.ok === "approved" && <p className="chip done">{t("okApproved")}</p>}
      {sp.ok === "status" && <p className="chip done">{t("okStatus")}</p>}
      {sp.warn === "no_ai_key" && <p className="chip">{t("warnNoAiKey")}</p>}
      {sp.err === "empty_transcript" && <p className="chip">{t("errEmpty")}</p>}
      {sp.err === "drive_not_found" && (
        <p className="chip">{t("errDriveNotFound")}</p>
      )}
      {sp.err === "drive_empty_doc" && (
        <p className="chip">{t("errDriveEmpty")}</p>
      )}
      {sp.err === "drive_no_google_token" && (
        <p className="chip">{t("errDriveNoGoogle")}</p>
      )}
      {sp.err?.startsWith("drive_") &&
        ![
          "drive_not_found",
          "drive_empty_doc",
          "drive_no_google_token",
        ].includes(sp.err) && (
          <p className="chip">
            {t("errDriveGeneric")}: {sp.err}
          </p>
        )}

      <div style={{ marginTop: "1.2rem" }}>
        <ClassroomVideo
          lessonId={lesson.id}
          livekitReady={livekitReady}
          sttReady={sttReady}
          labels={{
            title: t("classroomTitle"),
            join: t("classroomJoin"),
            leave: t("classroomLeave"),
            connecting: t("classroomConnecting"),
            notConfigured: t("classroomNotConfigured"),
            recording: t("classroomRecording"),
            ending: t("classroomEnding"),
            endAndTranscribe: t("classroomEndTranscribe"),
            leaveOnly: t("classroomLeaveOnly"),
            errorToken: t("classroomErrToken"),
            errorTranscribe: t("classroomErrTranscribe"),
            okTranscribed: t("okLivekit"),
            sttMissing: t("classroomSttMissing"),
            hint: t("classroomHint"),
          }}
        />
      </div>

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>{t("driveTitle")}</h2>
            <p className="muted">{t("driveHint")}</p>
            {googleConnected ? (
              <form action={fetchDriveTranscriptForLesson}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <button
                  className="btn"
                  type="submit"
                  disabled={!lesson.student.recordingConsent}
                >
                  {t("fetchDrive")}
                </button>
              </form>
            ) : (
              <p>
                <a className="btn secondary" href="/settings">
                  {t("connectGoogleFirst")}
                </a>
              </p>
            )}
            {!lesson.student.recordingConsent && (
              <p className="muted" style={{ marginTop: "0.6rem" }}>
                {t("consentRequired")}
              </p>
            )}
          </div>

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

          {lesson.summary && (
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
          {lesson.meetLink && (
            <p>
              <a
                href={lesson.meetLink}
                target="_blank"
                rel="noreferrer"
                className="btn"
              >
                {t("joinMeet")}
              </a>
            </p>
          )}
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
