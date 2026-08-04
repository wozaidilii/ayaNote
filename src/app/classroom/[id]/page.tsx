import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassroomWorkspace } from "@/components/classroom-workspace";
import { courseTypeLabel } from "@/lib/ai";
import { getAccessibleLesson } from "@/lib/classroom-access";
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
  if (!access.ok) {
    if (access.status === 404) notFound();
    notFound();
  }

  const { lesson, role } = access;
  const t = await getTranslations("classroom");
  const prep = await getTranslations("prep");
  const lessonRoom = await getTranslations("lessonRoom");
  const timeZone = normalizeTimezone(lesson.teacher.timezone);
  const isPast = lesson.status === "completed" || lesson.status === "cancelled";
  const livekitReady = livekitConfigured();
  const sttReady = sttConfigured();

  return (
    <div className="classroom-page">
      <header className="classroom-page-header">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            AyaNote Classroom ·{" "}
            {role === "teacher" ? lesson.student.name : lesson.teacher.name}
          </p>
          <h1
            className="h1"
            style={{ marginTop: "0.25rem", fontSize: "1.45rem" }}
          >
            {formatInTz(lesson.startsAt, "yyyy-MM-dd HH:mm", timeZone)}
            <span className="muted" style={{ fontWeight: 500 }}>
              {" "}
              – {formatInTz(lesson.endsAt, "HH:mm", timeZone)}
            </span>
          </h1>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              marginTop: "0.4rem",
            }}
          >
            <span className="chip sky">
              {courseTypeLabel(lesson.student.courseType)}
            </span>
            <span className="chip">{lesson.student.level}</span>
            <span className="chip">{lesson.status}</span>
            {isPast && <span className="chip">{t("pastChip")}</span>}
          </div>
        </div>
        <div className="classroom-page-actions">
          {role === "teacher" && (
            <Link className="btn secondary" href={`/lessons/${lesson.id}`}>
              {t("openLessonRoom")}
            </Link>
          )}
          <Link
            className="btn ghost"
            href={role === "teacher" ? "/today" : "/student"}
          >
            {t("back")}
          </Link>
        </div>
      </header>

      {sp.ok === "livekit" && (
        <p className="chip done">{lessonRoom("okLivekit")}</p>
      )}

      <ClassroomWorkspace
        lessonId={lesson.id}
        isPast={isPast}
        livekitReady={livekitReady}
        sttReady={sttReady}
        pastBanner={t("pastBanner")}
        board={{
          warmup: lesson.prepDraft?.warmup ?? "",
          review: lesson.prepDraft?.review ?? "",
          newFocus: lesson.prepDraft?.newFocus ?? "",
          practice: lesson.prepDraft?.practice ?? "",
          homeworkSeed: lesson.prepDraft?.homeworkSeed ?? "",
          classroomNotes: lesson.classroomNotes ?? "",
          prepUpdatedAt: lesson.prepDraft?.updatedAt.toISOString() ?? null,
          notesUpdatedAt: lesson.updatedAt.toISOString(),
          lessonUpdatedAt: lesson.updatedAt.toISOString(),
        }}
        videoLabels={{
          title: lessonRoom("classroomTitle"),
          join: lessonRoom("classroomJoin"),
          leave: lessonRoom("classroomLeave"),
          connecting: lessonRoom("classroomConnecting"),
          notConfigured: lessonRoom("classroomNotConfigured"),
          recording: lessonRoom("classroomRecording"),
          ending: lessonRoom("classroomEnding"),
          endAndTranscribe: lessonRoom("classroomEndTranscribe"),
          leaveOnly: lessonRoom("classroomLeaveOnly"),
          errorToken: lessonRoom("classroomErrToken"),
          errorTranscribe: lessonRoom("classroomErrTranscribe"),
          okTranscribed: lessonRoom("okLivekit"),
          sttMissing: lessonRoom("classroomSttMissing"),
          hint: lessonRoom("classroomHint"),
        }}
        boardLabels={{
          planTitle: t("planTitle"),
          notesTitle: t("notesTitle"),
          warmup: prep("sectionWarmup"),
          review: prep("sectionReview"),
          newFocus: prep("sectionNewFocus"),
          practice: prep("sectionPractice"),
          homework: prep("sectionHomework"),
          notesHint: t("notesHint"),
          saving: t("saving"),
          saved: t("saved"),
          peerUpdated: t("peerUpdated"),
          saveError: t("saveError"),
        }}
      />
    </div>
  );
}
