import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { setLocale, setRole } from "@/app/actions";
import { getSession } from "@/lib/session";

export async function AppShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active: string;
}) {
  const t = await getTranslations();
  const { role, locale } = await getSession();

  const teacherLinks = [
    { href: "/today", key: "today" },
    { href: "/calendar", key: "calendar" },
    { href: "/students", key: "students" },
    { href: "/prep", key: "prep" },
    { href: "/availability", key: "availability" },
    { href: "/settings", key: "settings" },
  ] as const;

  const studentLinks = [
    { href: "/student", key: "home" },
    { href: "/student/book", key: "book" },
    { href: "/student/history", key: "history" },
  ] as const;

  const links = role === "teacher" ? teacherLinks : studentLinks;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          {t("brand")}
        </Link>
        <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.92rem" }}>
          {role === "teacher" ? "Ayano" : "Alex"} · study desk
        </p>
        <nav style={{ marginTop: "1.35rem" }}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="nav-link"
              data-active={active === link.key}
            >
              {t(`nav.${link.key}`)}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: "1.8rem", display: "grid", gap: "0.5rem" }}>
          <form action={setLocale.bind(null, locale === "ja" ? "en" : "ja")}>
            <button className="btn secondary" type="submit" style={{ width: "100%" }}>
              {t("common.language")}: {locale.toUpperCase()}
            </button>
          </form>
          <form action={setRole.bind(null, role === "teacher" ? "student" : "teacher")}>
            <button className="btn ghost" type="submit" style={{ width: "100%" }}>
              {role === "teacher" ? t("nav.switchStudent") : t("nav.switchTeacher")}
            </button>
          </form>
        </div>
      </aside>
      <main className="main fade-in">{children}</main>
    </div>
  );
}
