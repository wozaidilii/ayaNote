import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ClassroomWorkspace } from "@/components/classroom-workspace";
import { courseTypeLabel } from "@/lib/ai";
import { getAccessibleLesson } from "@/lib/classroom-access";
import {
  emptyClassroomDoc,
  parseClassroomDoc,
  seedClassroomDoc,
  serializeClassroomDoc,
} from "@/lib/classroom-doc";
import { prisma } from "@/lib/db";
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
  if (!access.ok) notFound();

  const { lesson, role, actorName } = access;
  const t = await getTranslations("classroom");
  const timeZone = normalizeTimezone(lesson.teacher.timezone);
  const isPast = lesson.status === "completed" || lesson.status === "cancelled";

  let doc = parseClassroomDoc(lesson.classroomDoc);
  if (!doc) {
    const seeded = seedClassroomDoc({
      warmup: lesson.prepDraft?.warmup,
      review: lesson.prepDraft?.review,
      newFocus: lesson.prepDraft?.newFocus,
      practice: lesson.prepDraft?.practice,
      homeworkSeed: lesson.prepDraft?.homeworkSeed,
      classroomNotes: lesson.classroomNotes,
    });
    const hasContent = Boolean(
      lesson.prepDraft || lesson.classroomNotes || lesson.classroomDoc,
    );
    doc = hasContent ? seeded : emptyClassroomDoc();
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { classroomDoc: serializeClassroomDoc(doc) },
    });
  }

  const titleLine =
    role === "teacher" ? lesson.student.name : lesson.teacher.name;
  const metaLine = `${formatInTz(lesson.startsAt, "MMM d · HH:mm", timeZone)} – ${formatInTz(lesson.endsAt, "HH:mm", timeZone)} · ${courseTypeLabel(lesson.student.courseType)} · ${lesson.student.level}${isPast ? ` · ${t("pastChip")}` : ""}`;

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
        backHref={role === "teacher" ? "/today" : "/student"}
        lessonRoomHref={role === "teacher" ? `/lessons/${lesson.id}` : null}
        labels={{
          connecting: t("connecting"),
          notConfigured: t("notConfigured"),
          recording: t("recording"),
          ending: t("ending"),
          endAndTranscribe: t("endAndTranscribe"),
          leaveOnly: t("leaveOnly"),
          errorToken: t("errorToken"),
          errorTranscribe: t("errorTranscribe"),
          sttMissing: t("sttMissing"),
          pastBanner: t("pastBanner"),
          docPlaceholder: t("docPlaceholder"),
          statusSaving: t("statusSaving"),
          statusSaved: t("statusSaved"),
          statusLive: t("statusLive"),
          statusError: t("statusError"),
        }}
      />
    </div>
  );
}
