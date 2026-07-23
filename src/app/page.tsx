import { setRole } from "@/app/actions";
import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("landing");
  const brand = await getTranslations();

  return (
    <div className="hero">
      <div className="hero-visual" aria-hidden />
      <div className="hero-card">
        <p className="muted" style={{ letterSpacing: "0.06em", fontSize: "0.86rem", margin: 0 }}>
          {brand("brand")} / アヤノート
        </p>
        <h1>{brand("brand")}</h1>
        <p style={{ fontSize: "1.12rem", maxWidth: "28rem", margin: 0, color: "var(--ink-soft)" }}>
          {brand("tagline")}
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "1.4rem 0 1.6rem",
            display: "grid",
            gap: "0.45rem",
            color: "var(--ink-soft)",
          }}
        >
          <li>{t("bullets.memory")}</li>
          <li>{t("bullets.prep")}</li>
          <li>{t("bullets.booking")}</li>
        </ul>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem" }}>
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
