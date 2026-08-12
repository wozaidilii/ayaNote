"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  archiveStudent,
  createStudent,
  restoreStudent,
  updateStudent,
} from "@/app/actions";
import {
  Archive,
  BookOpen,
  CalendarDays,
  Check,
  KeyRound,
  Plus,
  Search,
  Users,
  Video,
  X,
  UiIcon,
} from "@/components/icons";
import { EmptyState, PageHeading, PanelTitle } from "@/components/ui-heading";
import { COURSE_TYPES, courseTypeLabel } from "@/lib/ai";

export type StudentListItem = {
  id: string;
  name: string;
  email: string;
  level: string;
  courseType: string;
  goals: string;
  privateNotes: string;
  recordingConsent: boolean;
  hasPassword: boolean;
  archivedAt: string | null;
  attendanceCount: number;
  weaknesses: string[];
  strengths: string[];
  topics: string[];
  progressNote: string;
  startedAt: string;
  pricePerLesson: string;
  currency: string;
  lessonsPerWeek: string;
  priceNote: string;
  hasUpcoming: boolean;
  nextLessonLabel: string;
  nextLessonId: string | null;
  pendingHomework: number;
  loginUrl: string;
};

type Labels = {
  title: string;
  subtitle: string;
  addStudent: string;
  editStudent: string;
  name: string;
  email: string;
  account: string;
  password: string;
  passwordHint: string;
  passwordNew: string;
  passwordNewHint: string;
  create: string;
  save: string;
  search: string;
  searchPlaceholder: string;
  filterLevel: string;
  allLevels: string;
  showArchived: string;
  archived: string;
  archive: string;
  restore: string;
  consent: string;
  close: string;
  course: string;
  level: string;
  goals: string;
  attendance: string;
  noItems: string;
  loginCreds: string;
  loginCredsHint: string;
  loginUrl: string;
  statusUpcoming: string;
  statusHomework: string;
  statusPassword: string;
  statusConsent: string;
  statusArchived: string;
  noUpcoming: string;
  nextLesson: string;
  openClassroom: string;
  openPrep: string;
  openRoom: string;
  progress: string;
  strengths: string;
  weaknesses: string;
  topics: string;
  privateNotes: string;
  startedAt: string;
  pricePerLesson: string;
  currency: string;
  lessonsPerWeek: string;
  priceNote: string;
  details: string;
};

export function StudentsWorkspace({
  students,
  levels,
  labels,
  initialStudentId,
}: {
  students: StudentListItem[];
  levels: string[];
  labels: Labels;
  initialStudentId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [mode, setMode] = useState<"closed" | "create" | "detail">(
    initialStudentId ? "detail" : "closed",
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialStudentId ?? null,
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (showArchived ? !s.archivedAt : s.archivedAt) return false;
      if (level && s.level !== level) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
      );
    });
  }, [students, query, level, showArchived]);

  const selected = selectedId
    ? (students.find((s) => s.id === selectedId) ?? null)
    : null;

  const openCreate = () => {
    setSelectedId(null);
    setMode("create");
  };

  const openDetail = (id: string) => {
    setSelectedId(id);
    setMode("detail");
  };

  const closeDrawer = () => {
    setMode("closed");
  };

  return (
    <>
      <PageHeading
        icon={Users}
        title={labels.title}
        subtitle={labels.subtitle}
        actions={
          <>
            <span className="chip">{filtered.length}</span>
            <button className="btn sm" type="button" onClick={openCreate}>
              <UiIcon icon={Plus} size={15} />
              {labels.addStudent}
            </button>
          </>
        }
      />

      <div className="students-toolbar">
        <div className="students-search">
          <UiIcon icon={Search} className="students-search-icon" size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.search}
            autoComplete="off"
          />
        </div>
        <select
          className="students-level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          aria-label={labels.filterLevel}
        >
          <option value="">{labels.allLevels}</option>
          {levels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <label className="students-archived">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {labels.showArchived}
        </label>
      </div>

      <div className="panel">
        <PanelTitle
          icon={Users}
          trailing={<span className="chip">{filtered.length}</span>}
        >
          {labels.title}
        </PanelTitle>
        {filtered.length === 0 ? (
          <EmptyState icon={Users}>{labels.noItems}</EmptyState>
        ) : (
          filtered.map((student) => (
            <button
              type="button"
              className={`list-row students-list-row${selectedId === student.id && mode === "detail" ? " is-selected" : ""}`}
              key={student.id}
              onClick={() => openDetail(student.id)}
            >
              <div className="list-row-main">
                <div className="list-row-title">
                  {student.name}
                  {student.archivedAt ? (
                    <span className="chip" style={{ marginLeft: "0.4rem" }}>
                      {labels.archived}
                    </span>
                  ) : null}
                </div>
                <div className="list-row-meta">
                  {student.email} · {courseTypeLabel(student.courseType)} ·{" "}
                  {labels.level}: {student.level}
                </div>
                <div
                  className="students-status-icons"
                  aria-label={labels.details}
                >
                  <StatusIcon
                    active={student.hasUpcoming}
                    icon={CalendarDays}
                    label={labels.statusUpcoming}
                  />
                  <StatusIcon
                    active={student.pendingHomework > 0}
                    icon={BookOpen}
                    label={labels.statusHomework}
                    badge={
                      student.pendingHomework > 0
                        ? String(student.pendingHomework)
                        : undefined
                    }
                  />
                  <StatusIcon
                    active={student.hasPassword}
                    icon={KeyRound}
                    label={labels.statusPassword}
                  />
                  <StatusIcon
                    active={student.recordingConsent}
                    icon={Video}
                    label={labels.statusConsent}
                  />
                  <StatusIcon
                    active={Boolean(student.archivedAt)}
                    icon={Archive}
                    label={labels.statusArchived}
                  />
                  {student.attendanceCount > 0 ? (
                    <span
                      className="students-status-chip is-on"
                      title={labels.attendance}
                    >
                      <UiIcon icon={Check} size={14} />
                      <span>{student.attendanceCount}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div
        className={`students-drawer-backdrop ${mode !== "closed" ? "is-open" : ""}`}
        onClick={closeDrawer}
        aria-hidden={mode === "closed"}
      />
      <aside
        className={`students-drawer students-drawer-wide ${mode !== "closed" ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? labels.addStudent : labels.editStudent}
        aria-hidden={mode === "closed"}
      >
        <div className="students-drawer-head">
          <h2>
            {mode === "create"
              ? labels.addStudent
              : (selected?.name ?? labels.editStudent)}
          </h2>
          <button className="btn ghost sm" type="button" onClick={closeDrawer}>
            <UiIcon icon={X} size={15} />
            {labels.close}
          </button>
        </div>
        <div className="students-drawer-body">
          {mode === "create" ? (
            <CreateForm labels={labels} />
          ) : selected ? (
            <DetailPanel student={selected} labels={labels} />
          ) : null}
        </div>
      </aside>
    </>
  );
}

function StatusIcon({
  active,
  icon,
  label,
  badge,
}: {
  active: boolean;
  icon: typeof CalendarDays;
  label: string;
  badge?: string;
}) {
  return (
    <span
      className={`students-status-chip${active ? " is-on" : ""}`}
      title={label}
      aria-label={`${label}: ${active ? "yes" : "no"}`}
    >
      <UiIcon icon={icon} size={14} />
      {badge ? <span>{badge}</span> : null}
    </span>
  );
}

function CreateForm({ labels }: { labels: Labels }) {
  return (
    <form action={createStudent}>
      <div className="field">
        <label htmlFor="name">{labels.name}</label>
        <input id="name" name="name" required />
      </div>
      <div className="field">
        <label htmlFor="email">{labels.account}</label>
        <input
          id="email"
          name="email"
          type="text"
          autoComplete="off"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">{labels.password}</label>
        <input
          id="password"
          name="password"
          type="text"
          autoComplete="new-password"
          minLength={4}
          required
        />
        <p
          className="muted"
          style={{ fontSize: "0.85rem", margin: "0.35rem 0 0" }}
        >
          {labels.passwordHint}
        </p>
      </div>
      <div className="field">
        <label htmlFor="courseType">{labels.course}</label>
        <select id="courseType" name="courseType" defaultValue="jlpt_n4">
          {COURSE_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="levelNew">{labels.level}</label>
        <input id="levelNew" name="level" defaultValue="N4" />
      </div>
      <div className="field">
        <label htmlFor="goals">{labels.goals}</label>
        <input id="goals" name="goals" />
      </div>
      <label className="students-archived" style={{ marginBottom: "1rem" }}>
        <input type="checkbox" name="recordingConsent" />
        {labels.consent}
      </label>
      <button className="btn" type="submit">
        <UiIcon icon={Plus} size={15} />
        {labels.create}
      </button>
    </form>
  );
}

function DetailPanel({
  student,
  labels,
}: {
  student: StudentListItem;
  labels: Labels;
}) {
  return (
    <>
      <div className="students-creds panel" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>{labels.loginCreds}</h3>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {labels.loginCredsHint}
        </p>
        <dl className="students-creds-list">
          <div>
            <dt>{labels.loginUrl}</dt>
            <dd>
              <code>{student.loginUrl}</code>
            </dd>
          </div>
          <div>
            <dt>{labels.account}</dt>
            <dd>
              <code>{student.email}</code>
            </dd>
          </div>
          <div>
            <dt>{labels.password}</dt>
            <dd className="muted">
              {student.hasPassword
                ? labels.passwordNewHint
                : labels.passwordHint}
            </dd>
          </div>
        </dl>
      </div>

      {(student.nextLessonId || !student.hasUpcoming) && (
        <div
          className="students-quick-actions"
          style={{ marginBottom: "1rem" }}
        >
          {student.nextLessonId ? (
            <>
              <a
                className="btn sm"
                href={`/classroom/${student.nextLessonId}`}
                target="_blank"
                rel="noreferrer"
              >
                {labels.openClassroom}
              </a>
              <Link
                className="btn secondary sm"
                href={`/prep?lesson=${student.nextLessonId}`}
              >
                {labels.openPrep}
              </Link>
              <Link
                className="btn ghost sm"
                href={`/lessons/${student.nextLessonId}`}
              >
                {labels.openRoom}
              </Link>
            </>
          ) : (
            <span className="chip">{labels.noUpcoming}</span>
          )}
          {student.nextLessonLabel ? (
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {labels.nextLesson}: {student.nextLessonLabel}
            </span>
          ) : null}
        </div>
      )}

      <form action={updateStudent}>
        <input type="hidden" name="studentId" value={student.id} />
        <div className="field">
          <label htmlFor={`name-${student.id}`}>{labels.name}</label>
          <input
            id={`name-${student.id}`}
            name="name"
            defaultValue={student.name}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`email-${student.id}`}>{labels.account}</label>
          <input
            id={`email-${student.id}`}
            name="email"
            type="text"
            defaultValue={student.email}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`password-${student.id}`}>{labels.passwordNew}</label>
          <input
            id={`password-${student.id}`}
            name="password"
            type="text"
            autoComplete="new-password"
            minLength={4}
            placeholder="••••••••"
          />
          <p
            className="muted"
            style={{ fontSize: "0.85rem", margin: "0.35rem 0 0" }}
          >
            {labels.passwordNewHint}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`course-${student.id}`}>{labels.course}</label>
          <select
            id={`course-${student.id}`}
            name="courseType"
            defaultValue={student.courseType}
          >
            {COURSE_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`level-${student.id}`}>{labels.level}</label>
          <input
            id={`level-${student.id}`}
            name="level"
            defaultValue={student.level}
          />
        </div>
        <div className="field">
          <label htmlFor={`goals-${student.id}`}>{labels.goals}</label>
          <textarea
            id={`goals-${student.id}`}
            name="goals"
            defaultValue={student.goals}
          />
        </div>
        <div className="field">
          <label htmlFor={`startedAt-${student.id}`}>{labels.startedAt}</label>
          <input
            id={`startedAt-${student.id}`}
            name="startedAt"
            type="date"
            defaultValue={student.startedAt}
          />
        </div>
        <div className="field">
          <label htmlFor={`price-${student.id}`}>{labels.pricePerLesson}</label>
          <input
            id={`price-${student.id}`}
            name="pricePerLesson"
            type="number"
            min="0"
            step="1"
            defaultValue={student.pricePerLesson}
          />
        </div>
        <div className="field">
          <label htmlFor={`currency-${student.id}`}>{labels.currency}</label>
          <input
            id={`currency-${student.id}`}
            name="currency"
            defaultValue={student.currency || "JPY"}
          />
        </div>
        <div className="field">
          <label htmlFor={`lpw-${student.id}`}>{labels.lessonsPerWeek}</label>
          <input
            id={`lpw-${student.id}`}
            name="lessonsPerWeek"
            type="number"
            min="1"
            max="14"
            defaultValue={student.lessonsPerWeek}
          />
        </div>
        <div className="field">
          <label htmlFor={`priceNote-${student.id}`}>{labels.priceNote}</label>
          <textarea
            id={`priceNote-${student.id}`}
            name="priceNote"
            defaultValue={student.priceNote}
          />
        </div>
        <div className="field">
          <label htmlFor={`notes-${student.id}`}>{labels.privateNotes}</label>
          <textarea
            id={`notes-${student.id}`}
            name="privateNotes"
            defaultValue={student.privateNotes}
          />
        </div>
        <label className="students-archived" style={{ marginBottom: "0.8rem" }}>
          <input
            type="checkbox"
            name="recordingConsent"
            defaultChecked={student.recordingConsent}
          />
          {labels.consent}
        </label>
        <button className="btn" type="submit">
          {labels.save}
        </button>
      </form>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>{labels.progress}</h3>
        <p>
          <strong>{labels.attendance}:</strong> {student.attendanceCount}
        </p>
        <p>
          <strong>{labels.topics}:</strong> {student.topics.join(" · ") || "—"}
        </p>
        <p>
          <strong>{labels.strengths}:</strong>{" "}
          {student.strengths.join(" · ") || "—"}
        </p>
        <p>
          <strong>{labels.weaknesses}:</strong>{" "}
          {student.weaknesses.join(" · ") || "—"}
        </p>
        {student.progressNote ? (
          <p className="muted">{student.progressNote}</p>
        ) : null}
      </div>

      <div style={{ marginTop: "1rem" }}>
        {student.archivedAt ? (
          <form action={restoreStudent}>
            <input type="hidden" name="studentId" value={student.id} />
            <button className="btn" type="submit">
              {labels.restore}
            </button>
          </form>
        ) : (
          <form action={archiveStudent}>
            <input type="hidden" name="studentId" value={student.id} />
            <button className="btn danger" type="submit">
              <UiIcon icon={Archive} size={14} />
              {labels.archive}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
