import { getTranslations } from "next-intl/server";
import { disconnectGoogle } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getAiProvider } from "@/lib/ai";
import { googleConfigured } from "@/lib/google";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";

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

  return (
    <AppShell active="settings">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="panel" style={{ marginTop: "1.2rem" }}>
        <h2 style={{ marginTop: 0 }}>{t("googleTitle")}</h2>
        <p>{t("google")}</p>
        {sp.google === "connected" && <p className="chip done">{t("googleConnectedBanner")}</p>}
        {sp.google === "missing_creds" && <p className="chip">{t("googleMissingCreds")}</p>}
        {sp.google && sp.google !== "connected" && sp.google !== "missing_creds" && (
          <p className="chip">{t("googleError")}: {sp.google}</p>
        )}
        {connected ? (
          <>
            <p>
              <span className="chip done">{t("connectedAs")}</span>{" "}
              {teacher.googleConnectedEmail || "Workspace"}
            </p>
            <form action={disconnectGoogle}>
              <button className="btn danger" type="submit">
                {t("disconnectGoogle")}
              </button>
            </form>
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
        <h2 style={{ marginTop: 0 }}>AI</h2>
        <p>
          Active provider: <strong>{provider}</strong>{" "}
          <span className="chip sky">default: deepseek</span>
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          Set <code>AYANOTE_AI_PROVIDER=deepseek|openai</code>. Default is DeepSeek.
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--ink-soft)" }}>
          <li>
            <code>DEEPSEEK_API_KEY</code>: {hasDeepseek ? "configured" : "missing"}
          </li>
          <li>
            <code>OPENAI_API_KEY</code>: {hasOpenAI ? "configured" : "missing"}
          </li>
          <li>
            <code>AYANOTE_MODEL</code>:{" "}
            {process.env.AYANOTE_MODEL ??
              (provider === "deepseek" ? "deepseek-chat" : "gpt-4o-mini")}
          </li>
        </ul>
      </div>
    </AppShell>
  );
}
