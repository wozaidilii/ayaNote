import { hashPassword } from "../src/lib/auth";
import { prisma } from "../src/lib/db";
import {
  DEMO_STUDENT_EMAIL,
  DEMO_TEACHER_EMAIL,
  DEMO_TEACHER_PASSWORD,
} from "../src/lib/session";
import { toJson } from "../src/lib/utils";

/** Previous trial login id — migrate to DEMO_TEACHER_EMAIL when present. */
const LEGACY_TEACHER_EMAIL = "ayano@ayanote.app";

/** Minimal bootstrap — classes come from in-app booking + Classroom. */
async function main() {
  const passwordHash = await hashPassword(DEMO_TEACHER_PASSWORD);
  const loginId = DEMO_TEACHER_EMAIL as string;

  // Migrate previous trial account if still present under the old email.
  const legacy = await prisma.teacher.findUnique({
    where: { email: LEGACY_TEACHER_EMAIL },
  });
  if (legacy && loginId !== LEGACY_TEACHER_EMAIL) {
    const taken = await prisma.teacher.findUnique({
      where: { email: loginId },
    });
    if (!taken) {
      await prisma.teacher.update({
        where: { id: legacy.id },
        data: {
          email: loginId,
          name: "Admin",
          passwordHash,
          locale: "ja",
        },
      });
    }
  }

  const teacher = await prisma.teacher.upsert({
    where: { email: loginId },
    create: {
      name: "Admin",
      email: loginId,
      passwordHash,
      locale: "ja",
    },
    update: { name: "Admin", locale: "ja", passwordHash },
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
    where: {
      teacherId_email: { teacherId: teacher.id, email: DEMO_STUDENT_EMAIL },
    },
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

  console.log("Bootstrapped trial teacher (password login).");
  console.log({
    teacher: teacher.email,
    password: DEMO_TEACHER_PASSWORD,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
