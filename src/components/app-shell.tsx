import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { setLocale, setRole } from "@/app/actions";
import { getSession } from "@/lib/session";

export async function AppShell({
  children,
  active,
  personName,
}: {
  children: React.ReactNode;
  active?: string;
  personName?: string;
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
  const spaceLabel = role === "teacher" ? "Teacher space" : "Student space";
  const who = personName || (role === "teacher" ? "Ayano" : "Student");

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          {t("brand")}
        </Link>
        <p className="space-meta">
          {who} · {spaceLabel}
        </p>

        <div className="nav-section">
          <div className="nav-section-label">Pages</div>
          <nav>
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
        </div>

        <div className="sidebar-actions">
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
      <main className="main">
        <div className="doc-page fade-in">{children}</div>
      </main>
    </div>
  );
}
