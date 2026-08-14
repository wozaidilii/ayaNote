import { persistGoogleAccessToken } from "@/lib/calendar-sync";
import {
  getValidAccessToken,
  looksLikeMailbox,
  sendGmailMessage,
} from "@/lib/google";
import { formatInTz, normalizeTimezone } from "@/lib/timezone";

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

type MailTeacher = {
  id: string;
  email: string;
  name: string;
  timezone: string | null;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleTokenExpiry: Date | null;
  googleConnectedEmail: string | null;
};

async function teacherAccessToken(teacher: MailTeacher) {
  const accessToken = await getValidAccessToken(teacher);
  if (!accessToken) return null;
  await persistGoogleAccessToken(teacher.id, teacher, accessToken);
  return accessToken;
}

function whenLabel(startsAt: Date, timezone: string | null) {
  return formatInTz(
    startsAt,
    "yyyy-MM-dd HH:mm",
    normalizeTimezone(timezone || "Asia/Tokyo"),
  );
}

export async function notifyBookingSubmitted(opts: {
  teacher: MailTeacher;
  studentName: string;
  requestedStart: Date;
}) {
  const to = looksLikeMailbox(opts.teacher.googleConnectedEmail)
    ? opts.teacher.googleConnectedEmail!
    : looksLikeMailbox(opts.teacher.email)
      ? opts.teacher.email
      : null;
  if (!to) return;
  const accessToken = await teacherAccessToken(opts.teacher);
  if (!accessToken) return;

  const when = whenLabel(opts.requestedStart, opts.teacher.timezone);
  await sendGmailMessage({
    accessToken,
    to,
    subject: `AyaNote 予約リクエスト · ${opts.studentName}`,
    text: `${opts.studentName} さんが ${when} のレッスンをリクエストしました。\n\n確認: ${appUrl()}/calendar\n`,
  });
}

export async function notifyBookingDecision(opts: {
  teacher: MailTeacher;
  studentEmail: string;
  studentName: string;
  requestedStart: Date;
  approved: boolean;
}) {
  if (!looksLikeMailbox(opts.studentEmail)) return;
  const accessToken = await teacherAccessToken(opts.teacher);
  if (!accessToken) return;

  const when = whenLabel(opts.requestedStart, opts.teacher.timezone);
  const approved = opts.approved;
  await sendGmailMessage({
    accessToken,
    to: opts.studentEmail,
    subject: approved
      ? `AyaNote 予約が承認されました · ${when}`
      : `AyaNote 予約が辞退されました · ${when}`,
    text: approved
      ? `${opts.teacher.name} 先生が ${when} のレッスンを承認しました。\n\nポータル: ${appUrl()}/student\n`
      : `${opts.teacher.name} 先生が ${when} のリクエストを辞退しました。\n\n別の枠: ${appUrl()}/student/book\n`,
  });
}
