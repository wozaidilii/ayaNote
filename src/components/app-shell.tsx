import { logout, setLocale } from "@/app/actions";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
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
  const session = await getSession();
  const role = session.role ?? "teacher";
  const locale = session.locale;

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
  const spaceLabel = role === "teacher" ? "Teacher" : "Student";
  const who = personName || (role === "teacher" ? "Teacher" : "Student");

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            あ
          </span>
          {t("brand")}
        </Link>
        <p className="space-meta">
          {who} · {spaceLabel}
        </p>

        <div className="nav-section">
          <div className="nav-section-label">Workspace</div>
          <nav aria-label="Pages">
            {links.map((link) => {
              const isActive = active === link.key;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="nav-link"
                  data-active={isActive}
                  aria-current={isActive ? "page" : undefined}
                >
                  {t(`nav.${link.key}`)}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-actions">
          <form action={setLocale.bind(null, locale === "ja" ? "en" : "ja")}>
            <button
              className="btn secondary sm"
              type="submit"
              style={{ width: "100%" }}
            >
              {t("common.language")}: {locale.toUpperCase()}
            </button>
          </form>
          {session.authenticated && (
            <form action={logout}>
              <button
                className="btn ghost sm"
                type="submit"
                style={{ width: "100%" }}
              >
                {t("nav.logout")}
              </button>
            </form>
          )}
        </div>
      </aside>
      <main className="main">
        <div className="doc-page">{children}</div>
      </main>
    </div>
  );
}
