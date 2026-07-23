import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { approveSummary, importTranscriptAndSummarize } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/utils";

export default async function LessonRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      transcript: true,
      summary: true,
      prepDraft: true,
    },
  });
  if (!lesson) notFound();

  const lastFocus = lesson.student.lessons[0]?.summary?.nextFocus;
  const topics = lesson.summary ? parseJsonArray(lesson.summary.topicsJson) : [];
  const mistakes = lesson.summary ? parseJsonArray(lesson.summary.mistakesJson) : [];

  return (
    <AppShell active="today">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {lesson.student.name} · {format(lesson.startsAt, "yyyy-MM-dd HH:mm")} · {t("subtitle")}
      </p>

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <div>
          <form className="panel" action={importTranscriptAndSummarize}>
            <input type="hidden" name="lessonId" value={lesson.id} />
            <div className="field">
              <label htmlFor="transcript">{t("paste")}</label>
              <textarea
                id="transcript"
                name="transcript"
                placeholder={t("placeholder")}
                defaultValue={lesson.transcript?.editedText || lesson.transcript?.rawText || ""}
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
              {common("import")} / {common("generate")}
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
              <a href={lesson.meetLink} target="_blank" rel="noreferrer" className="btn ghost">
                Google Meet
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
