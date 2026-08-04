import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GraduationCap, LogIn, UiIcon } from "@/components/icons";

export default async function HomePage() {
  const t = await getTranslations("landing");
  const brand = await getTranslations();

  return (
    <div className="hero">
      <div className="hero-card">
        <p className="doc-breadcrumb" style={{ marginBottom: 4 }}>
          <span>AyaNote</span>
          <span>/</span>
          <span>Home</span>
        </p>
        <h1 className="page-title">
          <UiIcon icon={GraduationCap} className="page-title-icon" size={28} />
          <span>{brand("brand")}</span>
        </h1>
        <p className="muted" style={{ margin: "0 0 16px", maxWidth: "34rem" }}>
          {brand("tagline")}
        </p>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Overview</h2>
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.2rem",
              color: "var(--ink-soft)",
            }}
          >
            <li>{t("bullets.memory")}</li>
            <li>{t("bullets.prep")}</li>
            <li>{t("bullets.booking")}</li>
          </ul>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Link className="btn" href="/login">
            <UiIcon icon={LogIn} size={15} />
            {t("ctaTeacher")}
          </Link>
        </div>
        <p className="muted" style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
          {t("studentInviteHint")}
        </p>
      </div>
    </div>
  );
}
