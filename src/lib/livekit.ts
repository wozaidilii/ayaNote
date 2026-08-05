import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export function livekitConfigured() {
  return Boolean(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET,
  );
}

export function livekitRoomName(lessonId: string) {
  return `lesson_${lessonId}`;
}

/** RoomService host must be http(s); LIVEKIT_URL is often ws(s). */
function livekitHttpHost() {
  const raw = process.env.LIVEKIT_URL ?? "";
  return raw.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
}

export function createLivekitRoomService() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const host = livekitHttpHost();
  if (!apiKey || !apiSecret || !host) {
    throw new Error("LiveKit is not configured");
  }
  return new RoomServiceClient(host, apiKey, apiSecret);
}

/** Force-disconnect everyone in the lesson room (idempotent if already gone). */
export async function deleteLivekitRoom(lessonId: string) {
  if (!livekitConfigured()) return;
  const svc = createLivekitRoomService();
  try {
    await svc.deleteRoom(livekitRoomName(lessonId));
  } catch {
    /* room may already be empty / deleted */
  }
}

export async function createLivekitToken(opts: {
  lessonId: string;
  identity: string;
  name: string;
  canPublish?: boolean;
}) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret || !process.env.LIVEKIT_URL) {
    throw new Error("LiveKit is not configured");
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: "4h",
  });

  at.addGrant({
    roomJoin: true,
    room: livekitRoomName(opts.lessonId),
    canPublish: opts.canPublish ?? true,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    token: await at.toJwt(),
    url: process.env.LIVEKIT_URL,
    roomName: livekitRoomName(opts.lessonId),
  };
}
