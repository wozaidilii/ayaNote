import { getTranslations } from "next-intl/server";
import { login } from "@/app/actions";
import { LogIn, UiIcon } from "@/components/icons";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ended?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (session.authenticated && session.role === "teacher") {
    redirect("/today");
  }
  if (session.authenticated && session.role === "student") {
    redirect("/student");
  }

  const t = await getTranslations("login");
  const classroom = await getTranslations("classroom");
  const brand = await getTranslations();

  return (
    <div className="hero">
      <div className="hero-card">
        <h1 className="h1 page-title">
          <UiIcon icon={LogIn} className="page-title-icon" size={22} />
          <span>{brand("brand")}</span>
        </h1>
        <p className="muted">{t("subtitle")}</p>

        {sp.ended === "1" && (
          <p className="chip done">{classroom("classEnded")}</p>
        )}
        {sp.err === "missing" && <p className="chip">{t("errMissing")}</p>}
        {sp.err === "invalid" && <p className="chip">{t("errInvalid")}</p>}

        <form className="panel" action={login} style={{ marginTop: "1rem" }}>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input
              id="email"
              name="email"
              type="text"
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t("password")}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn" type="submit">
            <UiIcon icon={LogIn} size={15} />
            {t("submit")}
          </button>
        </form>

        <p className="muted" style={{ marginTop: "1rem" }}>
          {t("studentHint")}
        </p>
      </div>
    </div>
  );
}
