"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createStudent } from "@/app/actions";
import { COURSE_TYPES, courseTypeLabel } from "@/lib/ai";
import { parseJsonArray } from "@/lib/utils";

export type StudentListItem = {
  id: string;
  name: string;
  email: string;
  level: string;
  courseType: string;
  archivedAt: string | null;
  attendanceCount: number;
  weaknesses: string[];
};

type Labels = {
  title: string;
  subtitle: string;
  addStudent: string;
  name: string;
  email: string;
  create: string;
  search: string;
  searchPlaceholder: string;
  filterLevel: string;
  allLevels: string;
  showArchived: string;
  archived: string;
  consent: string;
  close: string;
  course: string;
  level: string;
  goals: string;
  attendance: string;
  noItems: string;
  open: string;
};

export function StudentsWorkspace({
  students,
  levels,
  labels,
}: {
  students: StudentListItem[];
  levels: string[];
  labels: Labels;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  return (
    <>
      <header className="page-header">
        <div className="page-header-text">
          <h1 className="h1">{labels.title}</h1>
          <p className="muted">{labels.subtitle}</p>
        </div>
        <div className="page-header-actions">
          <span className="chip">{filtered.length}</span>
          <button
            className="btn sm"
            type="button"
            onClick={() => setDrawerOpen(true)}
          >
            {labels.addStudent}
          </button>
        </div>
      </header>

      <div className="students-toolbar">
        <div className="students-search">
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
        <div className="panel-header">
          <h2>{labels.title}</h2>
          <span className="chip">{filtered.length}</span>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{labels.noItems}</p>
          </div>
        ) : (
          filtered.map((student) => (
            <div className="list-row" key={student.id}>
              <div className="list-row-main">
                <div className="list-row-title">
                  {student.name}
                  {student.archivedAt && (
                    <span className="chip" style={{ marginLeft: "0.4rem" }}>
                      {labels.archived}
                    </span>
                  )}
                </div>
                <div className="list-row-meta">
                  {student.email} · {courseTypeLabel(student.courseType)} ·{" "}
                  {labels.level}: {student.level} · {labels.attendance}:{" "}
                  {student.attendanceCount}
                </div>
                <div className="list-row-tags">
                  {student.weaknesses.slice(0, 3).map((w) => (
                    <span className="chip" key={w}>
                      {w}
                    </span>
                  ))}
                </div>
              </div>
              <div className="list-row-actions">
                <Link
                  className="btn secondary sm"
                  href={`/students/${student.id}`}
                >
                  {labels.open}
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <div
        className={`students-drawer-backdrop ${drawerOpen ? "is-open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
      />
      <aside
        className={`students-drawer ${drawerOpen ? "is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={labels.addStudent}
        aria-hidden={!drawerOpen}
      >
        <div className="students-drawer-head">
          <h2>{labels.addStudent}</h2>
          <button
            className="btn ghost sm"
            type="button"
            onClick={() => setDrawerOpen(false)}
          >
            {labels.close}
          </button>
        </div>
        <form className="students-drawer-body" action={createStudent}>
          <div className="field">
            <label htmlFor="name">{labels.name}</label>
            <input id="name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="email">{labels.email}</label>
            <input id="email" name="email" type="email" required />
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
            {labels.create}
          </button>
        </form>
      </aside>
    </>
  );
}
