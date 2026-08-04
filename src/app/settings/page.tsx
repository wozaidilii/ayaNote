import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { saveTeacherTimezone } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getAiProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import { TIMEZONE_OPTIONS, normalizeTimezone } from "@/lib/timezone";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const sp = await searchParams;
  const teacher = await requireTeacher();
  const t = await getTranslations("settings");
  const provider = getAiProvider();
  const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY);
  const hasOpenAI = Boolean(
    process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY,
  );
  const timeZone = normalizeTimezone(teacher.timezone);

  return (
    <AppShell active="settings" personName={teacher.name}>
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <div className="panel" style={{ marginTop: "1.2rem" }}>
        <h2 style={{ marginTop: 0 }}>{t("timezoneTitle")}</h2>
        <p className="muted">{t("timezoneExplain")}</p>
        {sp.saved === "timezone" && (
          <p className="chip done">{t("timezoneSaved")}</p>
        )}
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
        <h2 style={{ marginTop: 0 }}>{t("classroomTitle")}</h2>
        <p>{t("classroomExplain")}</p>
        <p className="muted">{t("stt")}</p>
        <p>{t("privacy")}</p>
        <Link className="btn secondary" href="/today">
          {t("openToday")}
        </Link>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>AI</h2>
        <p>
          Active provider: <strong>{provider}</strong>{" "}
          <span className="chip sky">default: deepseek</span>
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          Set <code>AYANOTE_AI_PROVIDER=deepseek|openai</code>. Default is
          DeepSeek.
        </p>
        <p className="muted">
          DeepSeek key: {hasDeepseek ? "set" : "missing"} · OpenAI key:{" "}
          {hasOpenAI ? "set" : "missing"}
        </p>
      </div>
    </AppShell>
  );
}
