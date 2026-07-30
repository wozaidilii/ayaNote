import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  approveSummary,
  fetchDriveTranscriptForLesson,
  importTranscriptAndSummarize,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getAiProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
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

export default async function LessonRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string; warn?: string; file?: string }>;
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
          vocabItems: { take: 5, orderBy: { createdAt: "desc" } },
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
  const topics = lesson.summary ? parseJsonArray(lesson.summary.topicsJson) : [];
  const mistakes = lesson.summary ? parseJsonArray(lesson.summary.mistakesJson) : [];
  const statusKey = TRANSCRIPT_STATUS_KEY[lesson.transcriptStatus] ?? "statusNone";
  const provider = getAiProvider();
  const hasAiKey =
    provider === "deepseek"
      ? Boolean(process.env.DEEPSEEK_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY);
  const googleConnected = Boolean(
    lesson.teacher.googleConnectedEmail || lesson.teacher.googleRefreshToken,
  );

  return (
    <AppShell active="today">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {lesson.student.name} · {format(lesson.startsAt, "yyyy-MM-dd HH:mm")} · {t("subtitle")}
      </p>

      <div style={{ marginTop: "0.8rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <span className="chip">{t(statusKey)}</span>
        {lesson.driveFileId && (
          <span className="chip sky">Drive: {lesson.driveFileId.slice(0, 8)}…</span>
        )}
        <span className="chip">{hasAiKey ? t("aiReady", { provider }) : t("aiMissing", { provider })}</span>
      </div>

      {sp.ok === "summary" && <p className="chip done">{t("okSummary")}</p>}
      {sp.ok === "drive" && (
        <p className="chip done">
          {t("okDrive")}
          {sp.file ? ` · ${decodeURIComponent(sp.file)}` : ""}
        </p>
      )}
      {sp.warn === "no_ai_key" && <p className="chip">{t("warnNoAiKey")}</p>}
      {sp.err === "empty_transcript" && <p className="chip">{t("errEmpty")}</p>}
      {sp.err === "drive_not_found" && <p className="chip">{t("errDriveNotFound")}</p>}
      {sp.err === "drive_empty_doc" && <p className="chip">{t("errDriveEmpty")}</p>}
      {sp.err === "drive_no_google_token" && <p className="chip">{t("errDriveNoGoogle")}</p>}
      {sp.err?.startsWith("drive_") &&
        !["drive_not_found", "drive_empty_doc", "drive_no_google_token"].includes(sp.err) && (
          <p className="chip">
            {t("errDriveGeneric")}: {sp.err}
          </p>
        )}

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>{t("driveTitle")}</h2>
            <p className="muted">{t("driveHint")}</p>
            {googleConnected ? (
              <form action={fetchDriveTranscriptForLesson}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <button className="btn" type="submit">
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
                defaultValue={lesson.transcript?.editedText || lesson.transcript?.rawText || ""}
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
              {lesson.summary ? t("regenerateSummary") : `${common("import")} / ${common("generate")}`}
            </button>
          </form>

          {lesson.summary && (
            <form className="panel" action={approveSummary}>
              <input type="hidden" name="lessonId" value={lesson.id} />
              <h2 style={{ marginTop: 0 }}>{common("topics")}</h2>
              <p>{topics.join(" · ") || "—"}</p>
              <p>
                <strong>{common("mistakes")}:</strong> {mistakes.join(" · ") || "—"}
              </p>
              <div className="field">
                <label htmlFor="homework">{common("homework")}</label>
                <textarea id="homework" name="homework" defaultValue={lesson.summary.homework} />
              </div>
              <div className="field">
                <label htmlFor="nextFocus">{common("nextFocus")}</label>
                <textarea id="nextFocus" name="nextFocus" defaultValue={lesson.summary.nextFocus} />
              </div>
              <div className="field">
                <label htmlFor="notes">Notes</label>
                <textarea id="notes" name="notes" defaultValue={lesson.summary.notes} />
              </div>
              <button className="btn" type="submit">
                {t("saveSummary")}
              </button>
              {lesson.summary.approved && (
                <p className="muted" style={{ marginTop: "0.75rem" }}>
                  Approved ✓
                </p>
              )}
            </form>
          )}
        </div>

        <aside className="panel">
          <h2 style={{ marginTop: 0 }}>{t("sidebar")}</h2>
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
            <strong>{common("weaknesses")}:</strong>{" "}
            {parseJsonArray(lesson.student.progress?.weaknessesJson).join(" · ") || "—"}
          </p>
          <h3>{common("vocab")}</h3>
          <ul>
            {lesson.student.vocabItems.map((v) => (
              <li key={v.id}>{v.term}</li>
            ))}
          </ul>
          {lesson.meetLink && (
            <p>
              <a href={lesson.meetLink} target="_blank" rel="noreferrer" className="btn">
                {t("joinMeet")}
              </a>
            </p>
          )}
          {lesson.prepDraft && (
            <div style={{ marginTop: "1rem" }}>
              <h3>Prep draft</h3>
              <p className="muted">{lesson.prepDraft.newFocus}</p>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
