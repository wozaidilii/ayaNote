import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { joinClassroomAsGuest } from "@/app/actions";
import { ClassroomWorkspace } from "@/components/classroom-workspace";
import { LogIn, UiIcon, Video } from "@/components/icons";
import { courseTypeLabel } from "@/lib/ai";
import {
  getAccessibleLesson,
  getLessonForGuestJoin,
} from "@/lib/classroom-access";
import {
  bindClassroomDocToPrep,
  parseClassroomDoc,
  serializeClassroomDoc,
} from "@/lib/classroom-doc";
import { parsePrepRefs } from "@/lib/prep-refs";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/utils";
import { livekitConfigured } from "@/lib/livekit";
import { sttConfigured } from "@/lib/stt";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";

export default async function ClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const access = await getAccessibleLesson(id);
  const t = await getTranslations("classroom");

  if (!access.ok) {
    const lesson = await getLessonForGuestJoin(id);
    if (!lesson || lesson.status === "cancelled") notFound();

    const timeZone = normalizeTimezone(lesson.teacher.timezone);
    return (
      <div className="hero">
        <div className="hero-card">
          <h1 className="h1 page-title">
            <UiIcon icon={Video} className="page-title-icon" size={22} />
            <span>{t("guestJoinTitle")}</span>
          </h1>
          <p className="muted">
            {t("guestJoinSubtitle", {
              teacher: lesson.teacher.name,
              when: formatInTz(lesson.startsAt, "MMM d · HH:mm", timeZone),
            })}
          </p>
          <form
            className="panel"
            action={joinClassroomAsGuest}
            style={{ marginTop: "1rem" }}
          >
            <input type="hidden" name="lessonId" value={lesson.id} />
            <div className="field">
              <label htmlFor="guest-name">{t("guestName")}</label>
              <input
                id="guest-name"
                name="name"
                type="text"
                defaultValue="Guest"
                maxLength={48}
                autoComplete="nickname"
                required
              />
            </div>
            <button className="btn" type="submit">
              <UiIcon icon={LogIn} size={15} />
              {t("guestJoinSubmit")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const { lesson, role, actorName } = access;
  const timeZone = normalizeTimezone(lesson.teacher.timezone);
  const isPast = lesson.status === "completed" || lesson.status === "cancelled";

  const refs = parsePrepRefs(lesson.prepDraft?.refsJson);
  const cloze = refs.vocabRecall;
  const lastApproved =
    role === "teacher"
      ? await prisma.lesson.findFirst({
          where: {
            studentId: lesson.studentId,
            id: { not: lesson.id },
            summary: { is: { approved: true } },
          },
          orderBy: { startsAt: "desc" },
          include: { summary: true },
        })
      : null;
  const bound = bindClassroomDocToPrep(
    parseClassroomDoc(lesson.classroomDoc),
    cloze,
  );
  const doc = bound.doc;
  if (bound.changed) {
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { classroomDoc: serializeClassroomDoc(doc) },
    });
  }

  const titleLine = t("classroomTitle");
  const whoLine =
    role === "teacher"
      ? lesson.student.name
      : role === "guest"
        ? `${lesson.teacher.name} · ${lesson.student.name}`
        : lesson.teacher.name;
  const metaLine = `${whoLine} · ${formatInTz(lesson.startsAt, "MMM d · HH:mm", timeZone)} – ${formatInTz(lesson.endsAt, "HH:mm", timeZone)} · ${courseTypeLabel(lesson.student.courseType)} · ${lesson.student.level}${isPast ? ` · ${t("pastChip")}` : ""}`;

  return (
    <div className="classroom-page">
      {sp.ok === "livekit" && (
        <p className="chip done" style={{ marginBottom: "0.75rem" }}>
          {t("okTranscribed")}
        </p>
      )}
      <ClassroomWorkspace
        lessonId={lesson.id}
        isPast={isPast}
        livekitReady={livekitConfigured()}
        sttReady={sttConfigured()}
        initialDoc={doc}
        userName={actorName}
        role={role}
        titleLine={titleLine}
        metaLine={metaLine}
        backHref={
          role === "teacher" ? "/today" : role === "student" ? "/student" : "/"
        }
        lessonRoomHref={role === "teacher" ? `/lessons/${lesson.id}` : null}
        teacherPrep={
          role === "teacher"
            ? {
                warmup: lesson.prepDraft?.warmup ?? "",
                review: lesson.prepDraft?.review ?? "",
                newFocus: lesson.prepDraft?.newFocus ?? "",
                practice: lesson.prepDraft?.practice ?? "",
                homeworkSeed: lesson.prepDraft?.homeworkSeed ?? "",
                vocabRecall: cloze,
                nextVocabRecall: refs.nextVocabRecall,
                course: courseTypeLabel(lesson.student.courseType),
                level: lesson.student.level,
                goals: lesson.student.goals ?? "",
                lastTodaySummary: lastApproved?.summary?.todaySummary ?? "",
                lastNextFocus: lastApproved?.summary?.nextFocus ?? "",
                lastMistakes: parseJsonArray(
                  lastApproved?.summary?.mistakesJson,
                ),
                vocab: refs.vocab,
              }
            : null
        }
        labels={{
          connecting: t("connecting"),
          notConfigured: t("notConfigured"),
          recording: t("recording"),
          ending: t("ending"),
          endAndTranscribe: t("endAndTranscribe"),
          leaveOnly: t("leaveOnly"),
          rejoin: t("rejoin"),
          leftCall: t("leftCall"),
          errorToken: t("errorToken"),
          errorTranscribe: t("errorTranscribe"),
          errorDuplicate: t("errorDuplicate"),
          sttMissing: t("sttMissing"),
          pastBanner: t("pastBanner"),
          docPlaceholder: t("docPlaceholder"),
          statusSaving: t("statusSaving"),
          statusSaved: t("statusSaved"),
          statusLive: t("statusLive"),
          statusError: t("statusError"),
          screenShare: t("screenShare"),
          restoreBoard: t("restoreBoard"),
          focusHint: t("focusHint"),
          classEnded: t("classEnded"),
          copyLink: t("copyLink"),
          linkCopied: t("linkCopied"),
          teacherPrepTitle: t("teacherPrepTitle"),
          teacherPrepOnly: t("teacherPrepOnly"),
          sectionWarmup: t("sectionWarmup"),
          sectionReview: t("sectionReview"),
          sectionNewFocus: t("sectionNewFocus"),
          sectionPractice: t("sectionPractice"),
          sectionHomework: t("sectionHomework"),
          teacherCloze: t("teacherCloze"),
          teacherClozeHint: t("teacherClozeHint"),
          teacherClozeNext: t("teacherClozeNext"),
          tabPlan: t("tabPlan"),
          tabCloze: t("tabCloze"),
          tabMaterials: t("tabMaterials"),
          materialsCourse: t("materialsCourse"),
          materialsGoals: t("materialsGoals"),
          materialsLastSummary: t("materialsLastSummary"),
          materialsLastFocus: t("materialsLastFocus"),
          materialsMistakes: t("materialsMistakes"),
          materialsVocab: t("materialsVocab"),
          materialsEmpty: t("materialsEmpty"),
          teacherPrepEmpty: t("teacherPrepEmpty"),
        }}
      />
    </div>
  );
}
