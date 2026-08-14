import {
  bindCalendarLessonStudent,
  createStudentForCalendarLesson,
} from "@/app/actions";
import { COURSE_TYPES } from "@/lib/ai";

export type UnassignedCalendarLesson = {
  id: string;
  startsAt: string;
  endsAt: string;
  title: string;
};

export type BindableStudent = { id: string; name: string };

export function CalendarUnassignedPanel({
  lessons,
  students,
  timeLabels,
  bindId,
  returnStart,
  view,
  labels,
}: {
  lessons: UnassignedCalendarLesson[];
  students: BindableStudent[];
  timeLabels: Record<string, string>;
  bindId?: string;
  returnStart: string;
  view: string;
  labels: {
    title: string;
    hint: string;
    pickExisting: string;
    createNew: string;
    name: string;
    email: string;
    password: string;
    level: string;
    course: string;
    bind: string;
    createAndBind: string;
    selectStudentPlaceholder: string;
    noStudents: string;
  };
}) {
  if (lessons.length === 0) return null;

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{labels.title}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {labels.hint}
      </p>
      {lessons.map((lesson) => {
        const highlight = bindId === lesson.id;
        return (
          <div
            key={lesson.id}
            id={`bind-${lesson.id}`}
            className={`unassigned-lesson ${highlight ? "is-focus" : ""}`}
          >
            <div className="list-row-title">
              {timeLabels[lesson.id] ?? lesson.startsAt}
            </div>
            <p className="muted" style={{ margin: "0.25rem 0 0.75rem" }}>
              {lesson.title}
            </p>

            <div className="unassigned-lesson-forms">
              <form action={bindCalendarLessonStudent}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <input type="hidden" name="returnStart" value={returnStart} />
                <input type="hidden" name="view" value={view} />
                <div className="field">
                  <label htmlFor={`bind-student-${lesson.id}`}>
                    {labels.pickExisting}
                  </label>
                  {students.length === 0 ? (
                    <p className="muted">{labels.noStudents}</p>
                  ) : (
                    <select
                      id={`bind-student-${lesson.id}`}
                      name="studentId"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {labels.selectStudentPlaceholder}
                      </option>
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {students.length > 0 && (
                  <button className="btn sm" type="submit">
                    {labels.bind}
                  </button>
                )}
              </form>

              <form action={createStudentForCalendarLesson}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <input type="hidden" name="returnStart" value={returnStart} />
                <input type="hidden" name="view" value={view} />
                <p style={{ fontWeight: 700, margin: "0 0 0.5rem" }}>
                  {labels.createNew}
                </p>
                <div className="field">
                  <label htmlFor={`new-name-${lesson.id}`}>{labels.name}</label>
                  <input
                    id={`new-name-${lesson.id}`}
                    name="name"
                    required
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`new-email-${lesson.id}`}>
                    {labels.email}
                  </label>
                  <input
                    id={`new-email-${lesson.id}`}
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`new-pass-${lesson.id}`}>
                    {labels.password}
                  </label>
                  <input
                    id={`new-pass-${lesson.id}`}
                    name="password"
                    type="password"
                    required
                    minLength={4}
                    autoComplete="new-password"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`new-level-${lesson.id}`}>
                    {labels.level}
                  </label>
                  <input
                    id={`new-level-${lesson.id}`}
                    name="level"
                    defaultValue="N4"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`new-course-${lesson.id}`}>
                    {labels.course}
                  </label>
                  <select
                    id={`new-course-${lesson.id}`}
                    name="courseType"
                    defaultValue="jlpt_n4"
                  >
                    {COURSE_TYPES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn sm" type="submit">
                  {labels.createAndBind}
                </button>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
