import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";

/** Lightweight invite landing — scaffolds student account link (demo still uses role cookie). */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const student = await prisma.student.findUnique({
    where: { inviteToken: token },
    include: { teacher: true },
  });
  if (!student || student.archivedAt) notFound();
  if (student.inviteTokenExpiresAt && student.inviteTokenExpiresAt < new Date()) {
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
        You&apos;re invited to AyaNote with {student.teacher.name}. Full login arrives soon — for
        now use the student demo view.
      </p>
      <div style={{ marginTop: "1.2rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <Link className="btn" href="/student">
          Open student home
        </Link>
        <Link className="btn secondary" href="/student/book">
          Book a lesson
        </Link>
      </div>
      <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
        Invite token reserved for one student / one account.
      </p>
    </AppShell>
  );
}
