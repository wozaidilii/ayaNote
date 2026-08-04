import { AccessToken } from "livekit-server-sdk";

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
