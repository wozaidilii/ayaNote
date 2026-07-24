import { setRole } from "@/app/actions";
import { getTranslations } from "next-intl/server";

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
        <h1>{brand("brand")}</h1>
        <p className="muted" style={{ margin: "0 0 16px", maxWidth: "34rem" }}>
          {brand("tagline")}
        </p>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Overview</h2>
          <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--ink-soft)" }}>
            <li>{t("bullets.memory")}</li>
            <li>{t("bullets.prep")}</li>
            <li>{t("bullets.booking")}</li>
          </ul>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <form action={setRole.bind(null, "teacher")}>
            <button className="btn" type="submit">
              {t("ctaTeacher")}
            </button>
          </form>
          <form action={setRole.bind(null, "student")}>
            <button className="btn secondary" type="submit">
              {t("ctaStudent")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
