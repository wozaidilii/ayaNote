import Link from "next/link";
import { acceptInvite } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

/** Invite landing — binds student cookie + role for the lite portal. */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const student = await prisma.student.findUnique({
    where: { inviteToken: token },
    include: { teacher: true },
  });
  if (!student || student.archivedAt) notFound();

  const expired =
    Boolean(student.inviteTokenExpiresAt && student.inviteTokenExpiresAt < new Date()) ||
    sp.err === "expired";

  if (expired) {
    return (
      <AppShell>
        <h1 className="h1">Invite expired</h1>
        <p className="muted">Ask your teacher to regenerate the invite link.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="h1">Welcome, {student.name}</h1>
      <p className="muted">
        You&apos;re invited to AyaNote with {student.teacher.name}. Opening the portal binds this
        invite to your session (lite student view).
      </p>
      <div style={{ marginTop: "1.2rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <form action={acceptInvite.bind(null, token)}>
          <button className="btn" type="submit">
            Open student home
          </button>
        </form>
        <Link className="btn secondary" href="/student/book">
          Book a lesson
        </Link>
      </div>
    </AppShell>
  );
}
