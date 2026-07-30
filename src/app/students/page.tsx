import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createStudent } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { COURSE_TYPES, courseTypeLabel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; level?: string; archived?: string }>;
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 className="h1">{t("title")}</h1>
          <p className="muted">{t("subtitle")}</p>
        </div>
      </div>

      <form className="panel" style={{ marginTop: "1.2rem" }} method="get">
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
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.8rem" }}>
          <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
          {t("showArchived")}
        </label>
        <button className="btn secondary" type="submit">
          {t("applyFilters")}
        </button>
      </form>

      <form className="panel" action={createStudent}>
        <h2 style={{ marginTop: 0 }}>{t("addStudent")}</h2>
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
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.8rem" }}>
          <input type="checkbox" name="recordingConsent" />
          {t("consent")}
        </label>
        <button className="btn" type="submit">
          {t("create")}
        </button>
      </form>

      <div className="panel">
        {students.length === 0 && <p className="muted">{common("noItems")}</p>}
        {students.map((student) => (
          <div className="list-row" key={student.id}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {student.name}
                {student.archivedAt && (
                  <span className="chip" style={{ marginLeft: "0.4rem" }}>
                    {t("archived")}
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: "0.9rem" }}>
                {student.email} · {courseTypeLabel(student.courseType)} · {common("level")}:{" "}
                {student.level} · {common("attendance")}: {student.progress?.attendanceCount ?? 0}
              </div>
              <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {parseJsonArray(student.progress?.weaknessesJson)
                  .slice(0, 3)
                  .map((w) => (
                    <span className="chip" key={w}>
                      {w}
                    </span>
                  ))}
              </div>
            </div>
            <Link className="btn secondary" href={`/students/${student.id}`}>
              Open
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
