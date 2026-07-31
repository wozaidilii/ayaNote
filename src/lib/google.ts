/**
 * Google Workspace helpers for Calendar Meet + Drive transcripts.
 * Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
  "email",
].join(" ");

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGoogleRedirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/google/callback`
  );
}

export function buildGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google refresh failed: ${await res.text()}`);
  }
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getValidAccessToken(teacher: {
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleTokenExpiry: Date | null;
}): Promise<string | null> {
  if (!googleConfigured()) return null;
  if (
    teacher.googleAccessToken &&
    teacher.googleTokenExpiry &&
    teacher.googleTokenExpiry.getTime() > Date.now() + 60_000
  ) {
    return teacher.googleAccessToken;
  }
  if (!teacher.googleRefreshToken) return null;
  const refreshed = await refreshAccessToken(teacher.googleRefreshToken);
  return refreshed.access_token;
}

export type MeetCreateResult = {
  meetLink: string;
  calendarEventId: string;
};

export type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; organizer?: boolean }>;
  conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
};

/** List timed events on primary calendar (singleEvents expanded). */
export async function listCalendarEvents(opts: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
  maxResults?: number;
}): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: opts.timeMin.toISOString(),
    timeMax: opts.timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(opts.maxResults ?? 100),
    conferenceDataVersion: "1",
    fields:
      "items(id,status,summary,description,hangoutLink,htmlLink,start,end,attendees(email,displayName,self,organizer),conferenceData)",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  );
  if (!res.ok) {
    console.error("Calendar list failed", await res.text());
    return [];
  }
  const data = (await res.json()) as { items?: GoogleCalendarEvent[] };
  return data.items ?? [];
}

/** Create Calendar event with Google Meet. Falls back to demo link if OAuth missing. */
export async function createCalendarMeetEvent(opts: {
  accessToken: string | null;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  timeZone?: string;
  attendeeEmail?: string;
  fallbackId: string;
}): Promise<MeetCreateResult> {
  if (!opts.accessToken) {
    return {
      meetLink: `https://meet.google.com/lookup/ayanote-${opts.fallbackId.slice(0, 10)}`,
      calendarEventId: `demo-${opts.fallbackId}`,
    };
  }

  const timeZone = opts.timeZone || "Asia/Tokyo";
  const body = {
    summary: opts.summary,
    description: opts.description ?? "AyaNote lesson",
    start: { dateTime: opts.start.toISOString(), timeZone },
    end: { dateTime: opts.end.toISOString(), timeZone },
    attendees: opts.attendeeEmail ? [{ email: opts.attendeeEmail }] : [],
    conferenceData: {
      createRequest: {
        requestId: `ayanote-${opts.fallbackId}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Calendar Meet create failed", text);
    return {
      meetLink: `https://meet.google.com/lookup/ayanote-${opts.fallbackId.slice(0, 10)}`,
      calendarEventId: `fallback-${opts.fallbackId}`,
    };
  }

  const data = (await res.json()) as {
    id: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
  };
  const meetFromEntry = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  return {
    meetLink: data.hangoutLink || meetFromEntry || `https://meet.google.com/lookup/ayanote-${opts.fallbackId.slice(0, 10)}`,
    calendarEventId: data.id,
  };
}

export async function updateCalendarEvent(opts: {
  accessToken: string;
  eventId: string;
  start: Date;
  end: Date;
  timeZone?: string;
}) {
  if (opts.eventId.startsWith("demo-") || opts.eventId.startsWith("fallback-")) return;
  const timeZone = opts.timeZone || "Asia/Tokyo";
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(opts.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: { dateTime: opts.start.toISOString(), timeZone },
        end: { dateTime: opts.end.toISOString(), timeZone },
      }),
    },
  );
}

export async function listRecentDriveDocs(opts: {
  accessToken: string;
  query?: string;
  /** Prefer filename match (OR with fullText when both set). */
  nameContains?: string;
  folderId?: string | null;
  pageSize?: number;
}) {
  const qParts = ["mimeType = 'application/vnd.google-apps.document'", "trashed = false"];
  if (opts.folderId) qParts.push(`'${opts.folderId}' in parents`);

  const textFilters: string[] = [];
  if (opts.nameContains) {
    textFilters.push(`name contains '${opts.nameContains.replace(/'/g, "\\'")}'`);
  }
  if (opts.query) {
    textFilters.push(`fullText contains '${opts.query.replace(/'/g, "\\'")}'`);
  }
  if (textFilters.length === 1) qParts.push(textFilters[0]);
  else if (textFilters.length > 1) qParts.push(`(${textFilters.join(" or ")})`);

  const params = new URLSearchParams({
    q: qParts.join(" and "),
    pageSize: String(opts.pageSize ?? 25),
    fields: "files(id,name,createdTime,modifiedTime)",
    orderBy: "modifiedTime desc",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) {
    console.error("Drive list failed", await res.text());
    return [] as Array<{ id: string; name: string; createdTime?: string; modifiedTime?: string }>;
  }
  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; createdTime?: string; modifiedTime?: string }>;
  };
  return data.files ?? [];
}

export async function exportDriveDocText(accessToken: string, fileId: string) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive export failed: ${await res.text()}`);
  return res.text();
}
