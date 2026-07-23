import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";

export default async function SettingsPage() {
  const t = await getTranslations("settings");

  return (
    <AppShell active="settings">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>
      <div className="panel" style={{ marginTop: "1.2rem" }}>
        <p>{t("google")}</p>
        <p>{t("stt")}</p>
        <p>{t("privacy")}</p>
        <p className="muted">
          Optional: set <code>OPENAI_API_KEY</code> for richer AI summaries/prep. Without it, local
          heuristics still work.
        </p>
      </div>
    </AppShell>
  );
}
