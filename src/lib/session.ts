import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type AppRole = "teacher" | "student";

/** Seed / known trial teacher login id (stored in Teacher.email). */
export const DEMO_TEACHER_EMAIL = "admin";
export const DEMO_STUDENT_EMAIL = "alex@example.com";
/** Default password for seeded trial teacher (change in production). */
export const DEMO_TEACHER_PASSWORD = "123456";
/** Mock student login ids for multi-device classroom testing. */
export const DEMO_STUDENT_LOGINS = [
  { email: "student1", name: "Student 1" },
  { email: "student2", name: "Student 2" },
  { email: "student3", name: "Student 3" },
] as const;
/** Same password as demo teacher for mock students. */
export const DEMO_STUDENT_PASSWORD = DEMO_TEACHER_PASSWORD;

export type SessionInfo = {
  role: AppRole | null;
  locale: string;
  teacherId: string | null;
  studentId: string | null;
  authenticated: boolean;
};

export async function getSession(): Promise<SessionInfo> {
  const jar = await cookies();
  const locale = jar.get("ayanote_locale")?.value ?? "ja";
  const auth = await readAuthSession();
  if (!auth) {
    return {
      role: null,
      locale,
      teacherId: null,
      studentId: null,
      authenticated: false,
    };
  }
  return {
    role: auth.role,
    locale,
    teacherId: auth.teacherId ?? null,
    studentId: auth.studentId ?? null,
    authenticated: true,
  };
}

/** Teacher pages / actions — redirects to login if missing. */
export async function requireTeacher() {
  const session = await getSession();
  if (
    !session.authenticated ||
    session.role !== "teacher" ||
    !session.teacherId
  ) {
    redirect("/");
  }
  const teacher = await prisma.teacher.findUnique({
    where: { id: session.teacherId },
  });
  if (!teacher) redirect("/");
  return teacher;
}

/** Student portal — redirects to home if missing invite session. */
export async function requireStudent() {
  const session = await getSession();
  if (
    !session.authenticated ||
    session.role !== "student" ||
    !session.studentId
  ) {
    redirect("/");
  }
  const student = await prisma.student.findFirst({
    where: { id: session.studentId, archivedAt: null },
  });
  if (!student) redirect("/");
  return student;
}
