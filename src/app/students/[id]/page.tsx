import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import {
  archiveStudent,
  regenerateInviteToken,
  restoreStudent,
  updateStudent,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { Users } from "@/components/icons";
import { PageHeading } from "@/components/ui-heading";
import { COURSE_TYPES, courseTypeLabel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import { formatInTz, normalizeTimezone, ymdInTz } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teacher = await requireTeacher();
  const t = await getTranslations("students");
  const common = await getTranslations("common");
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      teacher: { select: { timezone: true } },
      progress: true,
      vocabItems: { orderBy: { createdAt: "desc" }, take: 8 },
      grammarItems: { orderBy: { createdAt: "desc" }, take: 8 },
      lessons: {
        include: { summary: true, prepDraft: true, homeworks: true },
        orderBy: { startsAt: "desc" },
        take: 10,
      },
    },
  });
  if (!student) notFound();
  if (student.teacherId !== teacher.id) redirect("/students");

  const timeZone = normalizeTimezone(student.teacher.timezone);

  const nextLesson = student.lessons
    .filter((l) => l.status === "scheduled" && l.startsAt >= new Date())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  const inviteUrl =
    student.inviteToken &&
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${student.inviteToken}`;

  return (
    <AppShell active="students" personName={teacher.name}>
      <PageHeading
        icon={Users}
        title={student.name}
        subtitle={
          <>
            {common("course")}: {courseTypeLabel(student.courseType)} ·{" "}
            {common("level")}: {student.level} · {student.email}
            {student.archivedAt && ` · ${t("archived")}`}
          </>
        }
      />

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
            <a
              className="btn"
              href={`/classroom/${nextLesson.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("nextLesson")}:{" "}
              {formatInTz(nextLesson.startsAt, "MMM d HH:mm", timeZone)}
            </a>
            {nextLesson.prepDraft && (
              <Link
                className="btn secondary"
                href={`/prep?lesson=${nextLesson.id}#lesson-${nextLesson.id}`}
              >
                {t("openPrep")}
              </Link>
            )}
            <Link className="btn ghost" href={`/lessons/${nextLesson.id}`}>
              {t("openRoom")}
            </Link>
          </>
        )}
        {!nextLesson && <span className="chip">{t("noUpcoming")}</span>}
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
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={student.email}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="courseType">{common("course")}</label>
            <select
              id="courseType"
              name="courseType"
              defaultValue={student.courseType}
            >
              {COURSE_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
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
            <label htmlFor="startedAt">{t("startedAt")}</label>
            <input
              id="startedAt"
              name="startedAt"
              type="date"
              defaultValue={
                student.startedAt ? ymdInTz(student.startedAt, timeZone) : ""
              }
            />
          </div>
          <div className="field">
            <label htmlFor="pricePerLesson">{t("pricePerLesson")}</label>
            <input
              id="pricePerLesson"
              name="pricePerLesson"
              type="number"
              step="1"
              min="0"
              defaultValue={
                student.pricePerLesson != null ? student.pricePerLesson : ""
              }
            />
          </div>
          <div className="field">
            <label htmlFor="currency">{t("currency")}</label>
            <input
              id="currency"
              name="currency"
              defaultValue={student.currency || "JPY"}
            />
          </div>
          <div className="field">
            <label htmlFor="lessonsPerWeek">{t("lessonsPerWeek")}</label>
            <input
              id="lessonsPerWeek"
              name="lessonsPerWeek"
              type="number"
              min="1"
              max="14"
              defaultValue={
                student.lessonsPerWeek != null ? student.lessonsPerWeek : ""
              }
            />
          </div>
          <div className="field">
            <label htmlFor="priceNote">{t("priceNote")}</label>
            <textarea
              id="priceNote"
              name="priceNote"
              defaultValue={student.priceNote}
            />
          </div>
          {(() => {
            let history: Array<{
              at: string;
              price: number;
              currency?: string;
            }> = [];
            try {
              const parsed = JSON.parse(student.priceHistoryJson || "[]");
              if (Array.isArray(parsed)) history = parsed;
            } catch {
              history = [];
            }
            if (history.length === 0) return null;
            return (
              <div className="field">
                <label>{t("priceHistory")}</label>
                <ul
                  className="muted"
                  style={{ margin: 0, paddingLeft: "1.1rem" }}
                >
                  {history
                    .slice()
                    .reverse()
                    .slice(0, 5)
                    .map((h, i) => (
                      <li key={`${h.at}-${i}`}>
                        {h.price} {h.currency || "JPY"} ·{" "}
                        {formatInTz(new Date(h.at), "yyyy-MM-dd", timeZone)}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })()}
          <div className="field">
            <label htmlFor="privateNotes">Private notes</label>
            <textarea
              id="privateNotes"
              name="privateNotes"
              defaultValue={student.privateNotes}
            />
          </div>
          <label
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              marginBottom: "0.8rem",
            }}
          >
            <input
              type="checkbox"
              name="recordingConsent"
              defaultChecked={student.recordingConsent}
            />
            {t("consent")}
          </label>
          <button className="btn" type="submit">
            {common("save")}
          </button>
        </form>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("progress")}</h2>
          <p>
            <strong>{common("attendance")}:</strong>{" "}
            {student.progress?.attendanceCount ?? 0}
          </p>
          <p>
            <strong>{common("topics")}:</strong>{" "}
            {parseJsonArray(student.progress?.topicsCoveredJson).join(" · ") ||
              "—"}
          </p>
          <p>
            <strong>{common("strengths")}:</strong>{" "}
            {parseJsonArray(student.progress?.strengthsJson).join(" · ") || "—"}
          </p>
          <p>
            <strong>{common("weaknesses")}:</strong>{" "}
            {parseJsonArray(student.progress?.weaknessesJson).join(" · ") ||
              "—"}
          </p>
          <p className="muted">{student.progress?.note}</p>

          <h3>{t("invite")}</h3>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            {t("inviteHint")}
          </p>
          {inviteUrl ? (
            <code
              style={{
                display: "block",
                wordBreak: "break-all",
                fontSize: "0.8rem",
              }}
            >
              {inviteUrl || `/invite/${student.inviteToken}`}
            </code>
          ) : (
            <p className="muted">—</p>
          )}
          {student.inviteTokenExpiresAt && (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {t("inviteExpires")}:{" "}
              {ymdInTz(student.inviteTokenExpiresAt, timeZone)}
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
              <div style={{ fontWeight: 650 }}>
                {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
              </div>
              <div className="muted">
                {lesson.summary?.nextFocus || lesson.status}
                {lesson.homeworks[0]
                  ? ` · ${t("homeworkStatus")}: ${lesson.homeworks[0].status}`
                  : ""}
              </div>
            </div>
            <a
              className="btn ghost"
              href={`/classroom/${lesson.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Classroom
            </a>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{common("vocab")}</h3>
          <ul>
            {student.vocabItems.map((v) => (
              <li key={v.id}>
                <strong>{v.term}</strong> {v.reading && `(${v.reading})`} —{" "}
                {v.meaning}
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
