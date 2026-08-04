import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AppRole } from "@/lib/session";

export const SESSION_COOKIE = "ayanote_session";
export const SESSION_DAYS = 60;

export type AuthSession = {
  role: AppRole;
  teacherId?: string;
  studentId?: string;
};

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    // Dev fallback so local runs work without env; production must set SESSION_SECRET
    return new TextEncoder().encode(
      process.env.SESSION_SECRET ?? "ayanote-dev-session-secret-change-me",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function signSession(payload: AuthSession) {
  return new SignJWT({
    role: payload.role,
    teacherId: payload.teacherId ?? null,
    studentId: payload.studentId ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(sessionSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    const role = payload.role;
    if (role !== "teacher" && role !== "student") return null;
    return {
      role,
      teacherId:
        typeof payload.teacherId === "string" ? payload.teacherId : undefined,
      studentId:
        typeof payload.studentId === "string" ? payload.studentId : undefined,
    };
  } catch {
    return null;
  }
}

export async function setAuthSession(payload: AuthSession) {
  const token = await signSession(payload);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  // Keep locale; clear legacy role cookies used for demo switching
  jar.set("ayanote_role", payload.role, {
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  if (payload.studentId) {
    jar.set("ayanote_student_id", payload.studentId, {
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
  } else {
    jar.delete("ayanote_student_id");
  }
}

export async function clearAuthSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete("ayanote_role");
  jar.delete("ayanote_student_id");
}

export async function readAuthSession(): Promise<AuthSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
