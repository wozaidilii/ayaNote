import { prisma } from "../src/lib/db";
import { DEMO_STUDENT_EMAIL, DEMO_TEACHER_EMAIL } from "../src/lib/session";
import { toJson } from "../src/lib/utils";

/** Minimal bootstrap — no fake lessons. Classes come from Google Calendar sync. */
async function main() {
  const teacher = await prisma.teacher.upsert({
    where: { email: DEMO_TEACHER_EMAIL },
    create: {
      name: "Ayano",
      email: DEMO_TEACHER_EMAIL,
      locale: "ja",
    },
    update: { name: "Ayano", locale: "ja" },
  });

  await prisma.availabilityRule.upsert({
    where: { teacherId: teacher.id },
    create: {
      teacherId: teacher.id,
      timezone: "Asia/Tokyo",
      weekdaysJson: toJson([1, 2, 3, 4, 5, 6]),
      startTime: "10:00",
      endTime: "20:00",
      slotMinutes: 60,
      minNoticeHours: 24,
      maxWeeklyLessons: 6,
    },
    update: {},
  });

  await prisma.student.upsert({
    where: { teacherId_email: { teacherId: teacher.id, email: DEMO_STUDENT_EMAIL } },
    create: {
      teacherId: teacher.id,
      name: "Alex Chen",
      email: DEMO_STUDENT_EMAIL,
      level: "N3",
      goals: "",
      privateNotes: "",
      recordingConsent: false,
      locale: "en",
    },
    update: {},
  });

  const dummyLessons = await prisma.lesson.findMany({
    where: {
      teacherId: teacher.id,
      OR: [
        { calendarEventId: null },
        { calendarEventId: { startsWith: "demo-" } },
        { calendarEventId: { startsWith: "fallback-" } },
        { meetLink: { contains: "aya-note" } },
      ],
    },
    select: { id: true },
  });
  const ids = dummyLessons.map((l) => l.id);
  if (ids.length) {
    await prisma.bookingRequest.deleteMany({ where: { lessonId: { in: ids } } });
    await prisma.prepDraft.deleteMany({ where: { lessonId: { in: ids } } });
    await prisma.summary.deleteMany({ where: { lessonId: { in: ids } } });
    await prisma.transcript.deleteMany({ where: { lessonId: { in: ids } } });
    await prisma.lesson.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.bookingRequest.deleteMany({
    where: { teacherId: teacher.id, note: { contains: "Work meeting conflict" } },
  });
  await prisma.student.deleteMany({
    where: { teacherId: teacher.id, email: "mina@example.com" },
  });

  console.log("Bootstrapped teacher (no dummy lessons). Connect Google Calendar to import classes.");
  console.log({ teacher: teacher.email, clearedLessons: ids.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
