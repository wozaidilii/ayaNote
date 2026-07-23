import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_STUDENT_EMAIL } from "@/lib/session";
import { parseJsonArray } from "@/lib/utils";

export default async function StudentHistoryPage() {
  const t = await getTranslations("studentHistory");
  const common = await getTranslations("common");
  const student = await prisma.student.findFirstOrThrow({
    where: { email: DEMO_STUDENT_EMAIL },
    include: {
      lessons: {
        where: { status: "completed" },
        include: { summary: true },
        orderBy: { startsAt: "desc" },
      },
    },
  });

  return (
    <AppShell active="history">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <div className="panel" style={{ marginTop: "1.2rem" }}>
        {student.lessons.length === 0 && <p className="muted">{common("noItems")}</p>}
        {student.lessons.map((lesson) => (
          <div className="list-row" key={lesson.id}>
            <div>
              <div style={{ fontWeight: 700 }}>{format(lesson.startsAt, "yyyy-MM-dd HH:mm")}</div>
              <div className="muted">
                {common("topics")}:{" "}
                {lesson.summary ? parseJsonArray(lesson.summary.topicsJson).join(" · ") : "—"}
              </div>
              <div>
                {common("homework")}: {lesson.summary?.homework || "—"}
              </div>
              <div>
                {common("nextFocus")}: {lesson.summary?.nextFocus || "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
