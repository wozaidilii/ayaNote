import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { disconnectGoogle, saveTeacherTimezone, saveTranscriptFolderId } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getAiProvider } from "@/lib/ai";
import { googleConfigured } from "@/lib/google";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";
import { TIMEZONE_OPTIONS, normalizeTimezone } from "@/lib/timezone";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const sp = await searchParams;
  const [t, teacher] = await Promise.all([
    getTranslations("settings"),
    prisma.teacher.findUniqueOrThrow({ where: { email: DEMO_TEACHER_EMAIL } }),
  ]);
  const provider = getAiProvider();
  const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY);
  const connected = Boolean(teacher.googleConnectedEmail || teacher.googleRefreshToken);
  const oauthReady = googleConfigured();
  const timeZone = normalizeTimezone(teacher.timezone);

  return (
    <AppShell active="settings">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="panel" style={{ marginTop: "1.2rem" }}>
        <h2 style={{ marginTop: 0 }}>{t("timezoneTitle")}</h2>
        <p className="muted">{t("timezoneExplain")}</p>
        {sp.google === "timezone_saved" && <p className="chip done">{t("timezoneSaved")}</p>}
        <form action={saveTeacherTimezone}>
          <div className="field">
            <label htmlFor="timezone">{t("timezoneLabel")}</label>
            <select id="timezone" name="timezone" defaultValue={timeZone}>
              {TIMEZONE_OPTIONS.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            {t("saveTimezone")}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("googleTitle")}</h2>
        <p>{t("google")}</p>
        {sp.google === "connected" && <p className="chip done">{t("googleConnectedBanner")}</p>}
        {sp.google === "folder_saved" && <p className="chip done">{t("googleFolderSaved")}</p>}
        {sp.google === "missing_creds" && <p className="chip">{t("googleMissingCreds")}</p>}
        {sp.google &&
          !["connected", "missing_creds", "folder_saved", "timezone_saved"].includes(sp.google) && (
            <p className="chip">
              {t("googleError")}: {sp.google}
            </p>
          )}
        {connected ? (
          <>
            <p>
              <span className="chip done">{t("connectedAs")}</span>{" "}
              {teacher.googleConnectedEmail || "Workspace"}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <Link className="btn" href="/calendar">
                Open Calendar sync
              </Link>
              <form action={disconnectGoogle}>
                <button className="btn danger" type="submit">
                  {t("disconnectGoogle")}
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{oauthReady ? t("googleReady") : t("googleMissingCreds")}</p>
            <a className="btn" href="/api/google/connect">
              {t("connectGoogle")}
            </a>
          </>
        )}
        <p style={{ marginTop: "1rem" }}>{t("stt")}</p>
        <p>{t("privacy")}</p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("driveTitle")}</h2>
        <p className="muted">{t("driveExplain")}</p>
        <form action={saveTranscriptFolderId}>
          <div className="field">
            <label htmlFor="googleTranscriptFolderId">{t("driveFolderLabel")}</label>
            <input
              id="googleTranscriptFolderId"
              name="googleTranscriptFolderId"
              placeholder={t("driveFolderPlaceholder")}
              defaultValue={teacher.googleTranscriptFolderId ?? ""}
            />
          </div>
          <button className="btn secondary" type="submit" disabled={!connected}>
            {t("saveFolder")}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>AI</h2>
        <p>
          Active provider: <strong>{provider}</strong>{" "}
          <span className="chip sky">default: deepseek</span>
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          Set <code>AYANOTE_AI_PROVIDER=deepseek|openai</code>. Default is DeepSeek.
        </p>
        <p className="muted">
          DeepSeek key: {hasDeepseek ? "set" : "missing"} · OpenAI key: {hasOpenAI ? "set" : "missing"}
        </p>
      </div>
    </AppShell>
  );
}
