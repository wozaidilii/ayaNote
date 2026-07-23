import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { SlotPicker } from "@/components/slot-picker";
import { prisma } from "@/lib/db";
import { generateAvailableSlots, groupSlotsByDay } from "@/lib/scheduling";
import { DEMO_STUDENT_EMAIL, DEMO_TEACHER_EMAIL } from "@/lib/session";
import { format } from "date-fns";

export default async function StudentBookPage() {
  const t = await getTranslations("studentBook");
  const common = await getTranslations("common");

  const teacher = await prisma.teacher.findUniqueOrThrow({
    where: { email: DEMO_TEACHER_EMAIL },
    include: { availabilityRules: true },
  });
  const student = await prisma.student.findFirstOrThrow({
    where: { email: DEMO_STUDENT_EMAIL },
    include: {
      bookingRequests: { orderBy: { createdAt: "desc" }, take: 8 },
      lessons: {
        where: { status: "scheduled", startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 1,
      },
    },
  });

  const rules = teacher.availabilityRules ?? {
    weekdaysJson: "[1,2,3,4,5,6]",
    startTime: "10:00",
    endTime: "20:00",
    minNoticeHours: 24,
    slotMinutes: 60,
  };

  const busyLessons = await prisma.lesson.findMany({
    where: {
      teacherId: teacher.id,
      status: { not: "cancelled" },
      startsAt: { gte: new Date(Date.now() - 86400000) },
    },
  });
  const pending = await prisma.bookingRequest.findMany({
    where: { teacherId: teacher.id, status: "pending" },
  });

  const busy = [
    ...busyLessons.map((l) => ({ start: l.startsAt, end: l.endsAt })),
    ...pending.map((b) => ({ start: b.requestedStart, end: b.requestedEnd })),
  ];

  const slots = generateAvailableSlots({ rules, busy, days: 14 });
  const days = groupSlotsByDay(slots).map((d) => ({
    dayKey: d.dayKey,
    label: d.label,
    slots: d.slots.map((s) => s.toISOString()),
  }));

  return (
    <AppShell active="book">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="panel" style={{ marginTop: "1.1rem" }}>
        <span className="pixel-banner">{t("slotRule")}</span>
        <p style={{ marginBottom: 0, marginTop: "0.7rem" }}>{t("slotHint")}</p>
      </div>

      <SlotPicker
        days={days}
        nextLessonId={student.lessons[0]?.id}
        labels={{
          pickSlot: t("pickSlot"),
          request: t("request"),
          note: t("note"),
          typeBook: t("typeBook"),
          typeReschedule: t("typeReschedule"),
          noSlots: t("noSlots"),
        }}
      />

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("recent")}</h2>
        {student.bookingRequests.map((b) => (
          <div className="list-row" key={b.id}>
            <div>
              <div style={{ fontWeight: 800 }}>
                {b.type} · {format(b.requestedStart, "yyyy-MM-dd HH:mm")} (+1h)
              </div>
              <div className="muted">{b.note || "—"}</div>
            </div>
            <span className="chip">{b.status}</span>
          </div>
        ))}
        {student.bookingRequests.length === 0 && <p className="muted">{common("noItems")}</p>}
      </div>
    </AppShell>
  );
}
