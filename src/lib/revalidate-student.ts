import { revalidatePath } from "next/cache";

/** Student lite portal paths that read lessons / homework. */
export function revalidateStudentPortal(lessonId?: string) {
  revalidatePath("/student");
  revalidatePath("/student/book");
  revalidatePath("/student/history");
  revalidatePath("/student/homework");
  if (lessonId) {
    revalidatePath(`/student/lessons/${lessonId}`);
    revalidatePath(`/classroom/${lessonId}`);
  }
}
