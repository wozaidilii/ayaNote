import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createStudent, seedMemoryFromDrive } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { COURSE_TYPES, courseTypeLabel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    level?: string;
    archived?: string;
    seeded?: string;
    created?: string;
    students?: string;
    skipped?: string;
    scanned?: string;
    seedErr?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const level = (sp.level ?? "").trim();
  const showArchived = sp.archived === "1";

  const [t, common, teacher] = await Promise.all([
    getTranslations("students"),
    getTranslations("common"),
    prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } }),
  ]);

  const googleConnected = Boolean(teacher.googleConnectedEmail || teacher.googleRefreshToken);

  const [students, levels] = await Promise.all([
    prisma.student.findMany({
      where: {
        teacherId: teacher.id,
        archivedAt: showArchived ? { not: null } : null,
        ...(level ? { level } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { progress: true },
      orderBy: { name: "asc" },
    }),
    prisma.student.findMany({
      where: { teacherId: teacher.id },
      select: { level: true },
      distinct: ["level"],
    }),
  ]);

  return (
    <AppShell active="students">
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="h1">{t("title")}</h1>
          <p className="muted">{t("subtitle")}</p>
        </div>
        <div className="page-header-actions">
          <span className="chip">{students.length}</span>
        </div>
      </header>

      {sp.seeded === "1" && (
        <p className="chip done" style={{ marginBottom: "1rem" }}>
          {t("seedDone", {
            created: sp.created ?? "0",
            students: sp.students ?? "0",
            scanned: sp.scanned ?? "0",
            skipped: sp.skipped ?? "0",
          })}
        </p>
      )}
      {sp.seedErr && (
        <p className="chip" style={{ marginBottom: "1rem" }}>
          {t("seedError")}: {decodeURIComponent(sp.seedErr)}
        </p>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>{t("seedDriveTitle")}</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("seedDriveHint")}
        </p>
        {googleConnected ? (
          <form action={seedMemoryFromDrive} style={{ marginTop: "12px" }}>
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                marginBottom: "0.8rem",
                color: "var(--ink-soft)",
                fontSize: "13px",
              }}
            >
              <input type="checkbox" name="force" value="1" />
              {t("seedDriveForce")}
            </label>
            <button className="btn" type="submit">
              {t("seedDrive")}
            </button>
          </form>
        ) : (
          <a className="btn secondary" href="/settings">
            Connect Google in Settings
          </a>
        )}
      </div>

      <form className="panel" method="get">
        <div className="panel-header">
          <h2>{t("search")}</h2>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="q">{t("search")}</label>
            <input id="q" name="q" defaultValue={q} placeholder="Name or email" />
          </div>
          <div className="field">
            <label htmlFor="level">{t("filterLevel")}</label>
            <select id="level" name="level" defaultValue={level}>
              <option value="">{t("allLevels")}</option>
              {levels.map((l) => (
                <option key={l.level} value={l.level}>
                  {l.level}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "0.8rem",
            color: "var(--ink-soft)",
            fontSize: "13px",
          }}
        >
          <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
          {t("showArchived")}
        </label>
        <button className="btn secondary" type="submit">
          {t("applyFilters")}
        </button>
      </form>

      <form className="panel" action={createStudent}>
        <div className="panel-header">
          <h2>{t("addStudent")}</h2>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="name">{t("name")}</label>
            <input id="name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input id="email" name="email" type="email" required />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="courseType">{common("course")}</label>
            <select id="courseType" name="courseType" defaultValue="jlpt_n4">
              {COURSE_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="levelNew">{common("level")}</label>
            <input id="levelNew" name="level" defaultValue="N4" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="goals">{common("goals")}</label>
          <input id="goals" name="goals" />
        </div>
        <label
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "0.8rem",
            color: "var(--ink-soft)",
            fontSize: "13px",
          }}
        >
          <input type="checkbox" name="recordingConsent" />
          {t("consent")}
        </label>
        <button className="btn" type="submit">
          {t("create")}
        </button>
      </form>

      <div className="panel">
        <div className="panel-header">
          <h2>{t("title")}</h2>
          <span className="chip">{students.length}</span>
        </div>
        {students.length === 0 ? (
          <div className="empty-state">
            <p>{common("noItems")}</p>
          </div>
        ) : (
          students.map((student) => (
            <div className="list-row" key={student.id}>
              <div className="list-row-main">
                <div className="list-row-title">
                  {student.name}
                  {student.archivedAt && (
                    <span className="chip" style={{ marginLeft: "0.4rem" }}>
                      {t("archived")}
                    </span>
                  )}
                </div>
                <div className="list-row-meta">
                  {student.email} · {courseTypeLabel(student.courseType)} · {common("level")}:{" "}
                  {student.level} · {common("attendance")}: {student.progress?.attendanceCount ?? 0}
                </div>
                <div className="list-row-tags">
                  {parseJsonArray(student.progress?.weaknessesJson)
                    .slice(0, 3)
                    .map((w) => (
                      <span className="chip" key={w}>
                        {w}
                      </span>
                    ))}
                </div>
              </div>
              <div className="list-row-actions">
                <Link className="btn secondary sm" href={`/students/${student.id}`}>
                  Open
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
