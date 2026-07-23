import { addDays, addHours, setHours, setMinutes, startOfDay } from "date-fns";
import { prisma } from "../src/lib/db";
import { DEMO_STUDENT_EMAIL, DEMO_TEACHER_EMAIL } from "../src/lib/session";
import { toJson } from "../src/lib/utils";

async function main() {
  await prisma.bookingRequest.deleteMany();
  await prisma.prepDraft.deleteMany();
  await prisma.summary.deleteMany();
  await prisma.transcript.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.vocabItem.deleteMany();
  await prisma.grammarItem.deleteMany();
  await prisma.progressSnapshot.deleteMany();
  await prisma.blackoutDate.deleteMany();
  await prisma.availabilityRule.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();

  const teacher = await prisma.teacher.create({
    data: {
      name: "Ayano",
      email: DEMO_TEACHER_EMAIL,
      locale: "ja",
      availabilityRules: {
        create: {
          timezone: "Asia/Tokyo",
          weekdaysJson: toJson([1, 2, 3, 4, 5, 6]),
          startTime: "10:00",
          endTime: "20:00",
          slotMinutes: 60,
          minNoticeHours: 24,
          maxWeeklyLessons: 6,
        },
      },
    },
  });

  const alex = await prisma.student.create({
    data: {
      teacherId: teacher.id,
      name: "Alex Chen",
      email: DEMO_STUDENT_EMAIL,
      level: "N3",
      goals: "Travel Japanese + workplace small talk",
      privateNotes: "Prefers practical role-play over textbook drills.",
      recordingConsent: true,
      locale: "en",
      vocabItems: {
        create: [
          { term: "よろしくお願いします", reading: "よろしくおねがいします", meaning: "Nice to work with you / please treat me well" },
          { term: "差し支えなければ", reading: "さしつかえなければ", meaning: "If it's all right / if you don't mind" },
        ],
      },
      grammarItems: {
        create: [
          { pattern: "〜ておく", notes: "Do something in advance" },
          { pattern: "〜ようにする", notes: "Make an effort to…" },
        ],
      },
      progress: {
        create: {
          topicsCoveredJson: toJson(["Self-intro", "Restaurant ordering", "て形 review"]),
          strengthsJson: toJson(["Listening", "Willingness to speak"]),
          weaknessesJson: toJson(["Particle は/が", "Keigo mixing"]),
          attendanceCount: 8,
          note: "Improving fluency; still hesitates on 敬語.",
        },
      },
    },
  });

  const mina = await prisma.student.create({
    data: {
      teacherId: teacher.id,
      name: "Mina Park",
      email: "mina@example.com",
      level: "N4",
      goals: "JLPT N3 path + daily conversation",
      recordingConsent: true,
      locale: "en",
      progress: {
        create: {
          topicsCoveredJson: toJson(["Family", "Daily routine"]),
          strengthsJson: toJson(["Vocab memorization"]),
          weaknessesJson: toJson(["Long sentences"]),
          attendanceCount: 4,
          note: "Needs more output practice.",
        },
      },
    },
  });

  const today = startOfDay(new Date());
  const lesson1Start = setMinutes(setHours(addHours(today, 0), 14), 30);
  const lesson2Start = setMinutes(setHours(addDays(today, 1), 11), 0);
  const lesson3Start = setMinutes(setHours(addDays(today, -3), 16), 30);

  const upcomingAlex = await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      studentId: alex.id,
      startsAt: lesson1Start,
      endsAt: addMinutesSafe(lesson1Start, 60),
      status: "scheduled",
      prepStatus: "draft",
      meetLink: "https://meet.google.com/aya-note-demo",
      prepDraft: {
        create: {
          warmup: "Ask about weekend plans using 〜つもり / 〜予定.",
          review: "Restaurant phrases + ておく.",
          newFocus: "Workplace small talk: お疲れ様です / 先日はありがとうございました.",
          practice: "2 role-plays: hallway chat + thanking a colleague.",
          homeworkSeed: "Write a short Slack-style Japanese thank-you message.",
          status: "draft",
        },
      },
    },
  });

  await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      studentId: mina.id,
      startsAt: lesson2Start,
      endsAt: addMinutesSafe(lesson2Start, 60),
      status: "scheduled",
      prepStatus: "none",
      meetLink: "https://meet.google.com/aya-note-mina",
    },
  });

  await prisma.lesson.create({
    data: {
      teacherId: teacher.id,
      studentId: alex.id,
      startsAt: lesson3Start,
      endsAt: addMinutesSafe(lesson3Start, 60),
      status: "completed",
      prepStatus: "ready",
      summary: {
        create: {
          topicsJson: toJson(["Restaurant ordering", "て形 practice"]),
          vocabJson: toJson([
            { term: "おすすめ", reading: "おすすめ", meaning: "recommendation" },
            { term: "会計", reading: "かいけい", meaning: "bill / check" },
          ]),
          grammarJson: toJson([{ pattern: "〜てください", notes: "Polite request" }]),
          mistakesJson: toJson(["Mixed は/が in これはおすすめです"]),
          homework: "Practice ordering dialogue twice aloud.",
          nextFocus: "Workplace greetings",
          notes: "Good energy; recycle particles next time.",
          approved: true,
        },
      },
      transcript: {
        create: {
          source: "meet_import",
          rawText: "Teacher: 今日はレストランの会話を練習しましょう。\nAlex: おすすめは何ですか？\nTeacher: この定食がおすすめです。",
          editedText: "Teacher: 今日はレストランの会話を練習しましょう。\nAlex: おすすめは何ですか？\nTeacher: この定食がおすすめです。",
        },
      },
    },
  });

  await prisma.bookingRequest.create({
    data: {
      teacherId: teacher.id,
      studentId: alex.id,
      type: "reschedule",
      requestedStart: setMinutes(setHours(addDays(today, 2), 15), 0),
      requestedEnd: setMinutes(setHours(addDays(today, 2), 15), 50),
      lessonId: upcomingAlex.id,
      status: "pending",
      note: "Work meeting conflict — can we move to Thursday 15:00?",
    },
  });

  console.log("Seeded AyaNote demo data");
  console.log({ teacher: teacher.email, student: alex.email, upcomingLesson: upcomingAlex.id });
}

function addMinutesSafe(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
