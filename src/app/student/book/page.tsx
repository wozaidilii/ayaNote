import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { SlotPicker } from "@/components/slot-picker";
import { getActiveStudent } from "@/lib/active-student";
import { prisma } from "@/lib/db";
import { generateAvailableSlots, groupSlotsByDay } from "@/lib/scheduling";

export default async function StudentBookPage() {
  const active = await getActiveStudent();
  const [t, common, teacher, student] = await Promise.all([
    getTranslations("studentBook"),
    getTranslations("common"),
    prisma.teacher.findUniqueOrThrow({
      where: { id: active.teacherId },
      include: {
        availabilityRules: true,
        blackoutDates: true,
      },
    }),
    prisma.student.findFirstOrThrow({
      where: { id: active.id },
      include: {
        bookingRequests: { orderBy: { createdAt: "desc" }, take: 12 },
        lessons: {
          where: { status: { not: "cancelled" } },
          orderBy: { startsAt: "asc" },
        },
      },
    }),
  ]);

  const rules = {
    weekdaysJson: teacher.availabilityRules?.weekdaysJson ?? "[1,2,3,4,5,6]",
    startTime: teacher.availabilityRules?.startTime ?? "10:00",
    endTime: teacher.availabilityRules?.endTime ?? "20:00",
    minNoticeHours: teacher.availabilityRules?.minNoticeHours ?? 24,
    slotMinutes: 60,
    maxWeeklyLessons: teacher.availabilityRules?.maxWeeklyLessons ?? 6,
    timezone:
      teacher.timezone || teacher.availabilityRules?.timezone || "Asia/Tokyo",
  };

  const [busyLessons, pending] = await Promise.all([
    prisma.lesson.findMany({
      where: {
        teacherId: teacher.id,
        status: { not: "cancelled" },
        startsAt: { gte: new Date(Date.now() - 86400000) },
      },
    }),
    prisma.bookingRequest.findMany({
      where: { teacherId: teacher.id, status: "pending" },
    }),
  ]);

  const busy = [
    ...busyLessons.map((l) => ({ start: l.startsAt, end: l.endsAt })),
    ...pending.map((b) => ({ start: b.requestedStart, end: b.requestedEnd })),
  ];

  const studentUpcoming = student.lessons.filter(
    (l) => l.status === "scheduled" && l.startsAt >= new Date(),
  );

  const slots = generateAvailableSlots({
    rules,
    busy,
    blackoutDates: teacher.blackoutDates.map((b) => b.date),
    studentLessonStarts: student.lessons
      .filter((l) => l.status !== "cancelled")
      .map((l) => l.startsAt),
    days: 14,
  });
  const days = groupSlotsByDay(slots, rules.timezone).map((d) => ({
    dayKey: d.dayKey,
    label: d.label,
    slots: d.slots.map((s) => s.toISOString()),
  }));

  return (
    <AppShell active="book" personName={student.name}>
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">
        {t("subtitle")} · {student.name}
      </p>

      <div className="panel" style={{ marginTop: "1.1rem" }}>
        <span className="pixel-banner">{t("slotRule")}</span>
        <p style={{ marginBottom: 0, marginTop: "0.7rem" }}>{t("slotHint")}</p>
      </div>

      <SlotPicker
        days={days}
        timeZone={rules.timezone}
        nextLessonId={studentUpcoming[0]?.id}
        bookings={student.bookingRequests.map((b) => ({
          id: b.id,
          type: b.type,
          status: b.status,
          note: b.note,
          requestedStart: b.requestedStart.toISOString(),
        }))}
        labels={{
          pickSlot: t("pickSlot"),
          request: t("request"),
          note: t("note"),
          typeBook: t("typeBook"),
          typeReschedule: t("typeReschedule"),
          noSlots: t("noSlots"),
          confirm: t("confirm"),
          duration: t("duration"),
          cancel: t("cancel"),
          myBookings: t("myBookings"),
        }}
      />

      {student.bookingRequests.length === 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{t("myBookings")}</h2>
          <p className="muted">{common("noItems")}</p>
        </div>
      )}
    </AppShell>
  );
}
