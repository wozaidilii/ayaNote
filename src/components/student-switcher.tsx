"use client";

import { setActiveStudent } from "@/app/actions";

type Option = {
  id: string;
  name: string;
  email: string;
  nextLabel?: string;
};

export function StudentSwitcher({
  students,
  activeId,
  label,
}: {
  students: Option[];
  activeId: string;
  label: string;
}) {
  if (students.length <= 1) return null;

  return (
    <form action={setActiveStudent} className="panel" style={{ marginTop: "1rem" }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="studentId">{label}</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <select
            id="studentId"
            name="studentId"
            defaultValue={activeId}
            style={{ flex: 1, minWidth: 180 }}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.email})
                {s.nextLabel ? ` · ${s.nextLabel}` : ""}
              </option>
            ))}
          </select>
          <button className="btn secondary" type="submit">
            Switch
          </button>
        </div>
      </div>
    </form>
  );
}
