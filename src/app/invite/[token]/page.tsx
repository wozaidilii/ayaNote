import { acceptInvite } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { GraduationCap, LogIn, UiIcon } from "@/components/icons";
import { PageHeading } from "@/components/ui-heading";
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
        <PageHeading
          icon={GraduationCap}
          title={t("expiredTitle")}
          subtitle={t("expiredBody")}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeading
        icon={GraduationCap}
        title={t("welcome", { name: student.name })}
        subtitle={t("body", { teacher: student.teacher.name })}
      />
      <form action={acceptInvite} style={{ marginTop: "0.4rem" }}>
        <input type="hidden" name="token" value={token} />
        <button className="btn" type="submit">
          <UiIcon icon={LogIn} size={15} />
          {t("enter")}
        </button>
      </form>
      <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
        {t("reuseHint")}
      </p>
    </AppShell>
  );
}
