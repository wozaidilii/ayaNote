import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { loginTeacher } from "@/app/actions";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
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

  return (
    <div className="hero">
      <div className="hero-card">
        <h1 className="h1">{t("title")}</h1>
        <p className="muted">{t("subtitle")}</p>

        {sp.err === "missing" && <p className="chip">{t("errMissing")}</p>}
        {sp.err === "invalid" && <p className="chip">{t("errInvalid")}</p>}

        <form
          className="panel"
          action={loginTeacher}
          style={{ marginTop: "1rem" }}
        >
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input
              id="email"
              name="email"
              type="email"
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
            {t("submit")}
          </button>
        </form>

        <p className="muted" style={{ marginTop: "1rem" }}>
          {t("studentHint")} <Link href="/">{t("backHome")}</Link>
        </p>
      </div>
    </div>
  );
}
