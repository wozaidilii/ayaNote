import { acceptInvite } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const student = await prisma.student.findUnique({
    where: { inviteToken: token },
    include: { teacher: true },
  });
  if (!student || student.archivedAt) notFound();

  if (
    student.inviteTokenExpiresAt &&
    student.inviteTokenExpiresAt < new Date()
  ) {
    return (
      <AppShell>
        <h1 className="h1">{t("expiredTitle")}</h1>
        <p className="muted">{t("expiredBody")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="h1">{t("welcome", { name: student.name })}</h1>
      <p className="muted">{t("body", { teacher: student.teacher.name })}</p>
      <form action={acceptInvite} style={{ marginTop: "1.2rem" }}>
        <input type="hidden" name="token" value={token} />
        <button className="btn" type="submit">
          {t("enter")}
        </button>
      </form>
      <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
        {t("reuseHint")}
      </p>
    </AppShell>
  );
}
