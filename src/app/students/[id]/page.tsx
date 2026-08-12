import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/session";

/** Detail editing moved to the students list right panel. */
export default async function StudentDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeacher();
  const { id } = await params;
  redirect(`/students?student=${id}`);
}
