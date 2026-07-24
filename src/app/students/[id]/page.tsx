import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  archiveStudent,
  regenerateInviteToken,
  restoreStudent,
  updateStudent,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("students");
  const common = await getTranslations("common");
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      progress: true,
      vocabItems: { orderBy: { createdAt: "desc" }, take: 8 },
      grammarItems: { orderBy: { createdAt: "desc" }, take: 8 },
      lessons: {
        include: { summary: true, prepDraft: true },
        orderBy: { startsAt: "desc" },
        take: 10,
      },
    },
  });
  if (!student) notFound();

  const nextLesson = student.lessons
    .filter((l) => l.status === "scheduled" && l.startsAt >= new Date())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  const inviteUrl =
    student.inviteToken &&
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${student.inviteToken}`;

  return (
    <AppShell active="students">
      <h1 className="h1">{student.name}</h1>
      <p className="muted">
        {common("level")}: {student.level} · {student.email}
        {student.archivedAt && ` · ${t("archived")}`}
      </p>

      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        {nextLesson && (
          <>
            <Link className="btn" href={`/lessons/${nextLesson.id}`}>
              {t("nextLesson")}: {format(nextLesson.startsAt, "MMM d HH:mm")}
            </Link>
            {nextLesson.prepDraft && (
              <Link className="btn secondary" href={`/prep#lesson-${nextLesson.id}`}>
                {t("openPrep")}
              </Link>
            )}
            <Link className="btn ghost" href={`/lessons/${nextLesson.id}`}>
              {t("openRoom")}
            </Link>
          </>
        )}
        {!nextLesson && (
          <span className="chip">{t("noUpcoming")}</span>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: "1.2rem" }}>
        <form className="panel" action={updateStudent}>
          <input type="hidden" name="studentId" value={student.id} />
          <div className="field">
            <label htmlFor="name">{t("name")}</label>
            <input id="name" name="name" defaultValue={student.name} required />
          </div>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input id="email" name="email" type="email" defaultValue={student.email} required />
          </div>
          <div className="field">
            <label htmlFor="level">{common("level")}</label>
            <input id="level" name="level" defaultValue={student.level} />
          </div>
          <div className="field">
            <label htmlFor="goals">{common("goals")}</label>
            <textarea id="goals" name="goals" defaultValue={student.goals} />
          </div>
          <div className="field">
            <label htmlFor="privateNotes">Private notes</label>
            <textarea id="privateNotes" name="privateNotes" defaultValue={student.privateNotes} />
          </div>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.8rem" }}>
            <input type="checkbox" name="recordingConsent" defaultChecked={student.recordingConsent} />
            {t("consent")}
          </label>
          <button className="btn" type="submit">
            {common("save")}
          </button>
        </form>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("progress")}</h2>
          <p>
            <strong>{common("attendance")}:</strong> {student.progress?.attendanceCount ?? 0}
          </p>
          <p>
            <strong>{common("topics")}:</strong>{" "}
            {parseJsonArray(student.progress?.topicsCoveredJson).join(" · ") || "—"}
          </p>
          <p>
            <strong>{common("strengths")}:</strong>{" "}
            {parseJsonArray(student.progress?.strengthsJson).join(" · ") || "—"}
          </p>
          <p>
            <strong>{common("weaknesses")}:</strong>{" "}
            {parseJsonArray(student.progress?.weaknessesJson).join(" · ") || "—"}
          </p>
          <p className="muted">{student.progress?.note}</p>

          <h3>{t("invite")}</h3>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            {t("inviteHint")}
          </p>
          {inviteUrl ? (
            <code style={{ display: "block", wordBreak: "break-all", fontSize: "0.8rem" }}>
              {inviteUrl || `/invite/${student.inviteToken}`}
            </code>
          ) : (
            <p className="muted">—</p>
          )}
          {student.inviteTokenExpiresAt && (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {t("inviteExpires")}: {format(student.inviteTokenExpiresAt, "yyyy-MM-dd")}
            </p>
          )}
          <form action={regenerateInviteToken} style={{ marginTop: "0.6rem" }}>
            <input type="hidden" name="studentId" value={student.id} />
            <button className="btn secondary" type="submit">
              {t("regenerateInvite")}
            </button>
          </form>

          <div style={{ marginTop: "1.2rem" }}>
            {student.archivedAt ? (
              <form action={restoreStudent}>
                <input type="hidden" name="studentId" value={student.id} />
                <button className="btn" type="submit">
                  {t("restore")}
                </button>
              </form>
            ) : (
              <form action={archiveStudent}>
                <input type="hidden" name="studentId" value={student.id} />
                <button className="btn danger" type="submit">
                  {t("archive")}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("timeline")}</h2>
        {student.lessons.map((lesson) => (
          <div className="list-row" key={lesson.id}>
            <div>
              <div style={{ fontWeight: 650 }}>{format(lesson.startsAt, "yyyy-MM-dd HH:mm")}</div>
              <div className="muted">{lesson.summary?.nextFocus || lesson.status}</div>
            </div>
            <Link className="btn ghost" href={`/lessons/${lesson.id}`}>
              Open
            </Link>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{common("vocab")}</h3>
          <ul>
            {student.vocabItems.map((v) => (
              <li key={v.id}>
                <strong>{v.term}</strong> {v.reading && `(${v.reading})`} — {v.meaning}
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{common("grammar")}</h3>
          <ul>
            {student.grammarItems.map((g) => (
              <li key={g.id}>
                <strong>{g.pattern}</strong> — {g.notes}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
