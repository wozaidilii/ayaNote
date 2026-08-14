import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { saveTeacherTimezone } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import {
  CalendarDays,
  Clock3,
  LayoutDashboard,
  Settings,
  Sparkles,
  Video,
  UiIcon,
} from "@/components/icons";
import { PageHeading, PanelTitle } from "@/components/ui-heading";
import { getAiProvider } from "@/lib/ai";
import { googleConfigured } from "@/lib/google";
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
      <PageHeading
        icon={Settings}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <div className="panel">
        <PanelTitle icon={Clock3}>{t("timezoneTitle")}</PanelTitle>
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
        <PanelTitle icon={CalendarDays}>{t("googleTitle")}</PanelTitle>
        <p className="muted">{t("googleExplain")}</p>
        {!googleConfigured() ? (
          <p className="chip">{t("googleNotConfigured")}</p>
        ) : teacher.googleRefreshToken ? (
          <>
            <p className="chip done">
              {t("googleConnectedAs", {
                email: teacher.googleConnectedEmail || "Google",
              })}
            </p>
            <a className="btn secondary" href="/api/google/connect">
              {t("connectGoogle")}
            </a>
          </>
        ) : (
          <>
            <p className="chip">{t("googleNotConnected")}</p>
            <a className="btn secondary" href="/api/google/connect">
              {t("connectGoogle")}
            </a>
          </>
        )}
      </div>

      <div className="panel">
        <PanelTitle icon={Video}>{t("classroomTitle")}</PanelTitle>
        <p>{t("classroomExplain")}</p>
        <p className="muted">{t("stt")}</p>
        <p>{t("privacy")}</p>
        <Link className="btn secondary" href="/today">
          <UiIcon icon={LayoutDashboard} size={15} />
          {t("openToday")}
        </Link>
      </div>

      <div className="panel">
        <PanelTitle icon={Sparkles}>AI</PanelTitle>
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
