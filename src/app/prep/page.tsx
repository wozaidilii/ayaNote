import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { generateLessonPrep, savePrepDraft } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";

export default async function PrepPage() {
  const t = await getTranslations("prep");
  const common = await getTranslations("common");
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } });
  const lessons = await prisma.lesson.findMany({
    where: {
      teacherId: teacher.id,
      status: "scheduled",
      startsAt: { gte: new Date(Date.now() - 86400000) },
    },
    include: { student: true, prepDraft: true },
    orderBy: { startsAt: "asc" },
  });

  return (
    <AppShell active="prep">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      {lessons.map((lesson) => (
        <div className="panel" key={lesson.id} id={`lesson-${lesson.id}`} style={{ marginTop: "1rem" }}>
          <div className="list-row" style={{ borderBottom: 0, paddingTop: 0 }}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {lesson.student.name} · {format(lesson.startsAt, "MMM d HH:mm")}
              </div>
              <span className="chip">{lesson.prepStatus}</span>
            </div>
            <form action={generateLessonPrep.bind(null, lesson.id)}>
              <button className="btn secondary" type="submit">
                {t("regenerate")}
              </button>
            </form>
          </div>

          <form action={savePrepDraft}>
            <input type="hidden" name="lessonId" value={lesson.id} />
            {(["warmup", "review", "newFocus", "practice", "homeworkSeed"] as const).map((field) => (
              <div className="field" key={field}>
                <label htmlFor={`${lesson.id}-${field}`}>{field}</label>
                <textarea
                  id={`${lesson.id}-${field}`}
                  name={field}
                  defaultValue={lesson.prepDraft?.[field] ?? ""}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              <button className="btn secondary" name="status" value="draft" type="submit">
                {common("save")} {common("draft")}
              </button>
              <button className="btn" name="status" value="ready" type="submit">
                {t("markReady")}
              </button>
            </div>
          </form>
        </div>
      ))}
    </AppShell>
  );
}
