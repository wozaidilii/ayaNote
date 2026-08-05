import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const GUEST_COOKIE = "ayanote_classroom_guest";
/** Align with LiveKit token TTL (~4h). */
export const GUEST_HOURS = 4;

export type ClassroomGuestSession = {
  lessonId: string;
  guestId: string;
  name: string;
};

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    return new TextEncoder().encode(
      process.env.SESSION_SECRET ?? "ayanote-dev-session-secret-change-me",
    );
  }
  return new TextEncoder().encode(secret);
}

export function createGuestId() {
  return randomBytes(12).toString("hex");
}

export async function signGuestSession(payload: ClassroomGuestSession) {
  return new SignJWT({
    lessonId: payload.lessonId,
    guestId: payload.guestId,
    name: payload.name,
    kind: "classroom_guest",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_HOURS}h`)
    .sign(sessionSecret());
}

export async function verifyGuestToken(
  token: string,
): Promise<ClassroomGuestSession | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (payload.kind !== "classroom_guest") return null;
    const lessonId = payload.lessonId;
    const guestId = payload.guestId;
    const name = payload.name;
    if (
      typeof lessonId !== "string" ||
      typeof guestId !== "string" ||
      typeof name !== "string"
    ) {
      return null;
    }
    return { lessonId, guestId, name };
  } catch {
    return null;
  }
}

export async function setGuestSession(payload: ClassroomGuestSession) {
  const token = await signGuestSession(payload);
  const jar = await cookies();
  jar.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_HOURS * 60 * 60,
  });
}

export async function clearGuestSession() {
  const jar = await cookies();
  jar.delete(GUEST_COOKIE);
}

export async function readGuestSession(): Promise<ClassroomGuestSession | null> {
  const jar = await cookies();
  const token = jar.get(GUEST_COOKIE)?.value;
  if (!token) return null;
  return verifyGuestToken(token);
}

export async function readGuestSessionForLesson(
  lessonId: string,
): Promise<ClassroomGuestSession | null> {
  const guest = await readGuestSession();
  if (!guest || guest.lessonId !== lessonId) return null;
  return guest;
}
