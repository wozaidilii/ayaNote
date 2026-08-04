import { getTranslations } from "next-intl/server";
import {
  addBlackoutDate,
  decideBooking,
  removeBlackoutDate,
  updateAvailability,
} from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { AvailabilityForm } from "@/components/availability-form";
import { Check, Clock3, Plus, X, UiIcon } from "@/components/icons";
import { PageHeading, PanelTitle } from "@/components/ui-heading";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/session";
import { formatInTz, normalizeTimezone, ymdInTz } from "@/lib/timezone";
import { parseJsonArray } from "@/lib/utils";

export default async function AvailabilityPage() {
  const sessionTeacher = await requireTeacher();
  const [t, common, teacher] = await Promise.all([
    getTranslations("availability"),
    getTranslations("common"),
    prisma.teacher.findUniqueOrThrow({
      where: { id: sessionTeacher.id },
      include: {
        availabilityRules: true,
        blackoutDates: { orderBy: { date: "asc" } },
      },
    }),
  ]);
  const rules = teacher.availabilityRules;
  const timeZone = normalizeTimezone(teacher.timezone || rules?.timezone);
  const bookings = await prisma.bookingRequest.findMany({
    where: { teacherId: teacher.id, status: "pending" },
    include: { student: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell active="availability" personName={teacher.name}>
      <PageHeading
        icon={Clock3}
        title={t("title")}
        subtitle={
          <>
            {t("subtitle")} · {timeZone}
          </>
        }
      />

      <AvailabilityForm
        action={updateAvailability}
        defaults={{
          startTime: rules?.startTime ?? "10:00",
          endTime: rules?.endTime ?? "20:00",
          minNoticeHours: rules?.minNoticeHours ?? 24,
          maxWeeklyLessons: rules?.maxWeeklyLessons ?? 6,
          weekdays: parseJsonArray(rules?.weekdaysJson ?? "[1,2,3,4,5,6]").map(
            Number,
          ),
          timezone: timeZone,
        }}
        labels={{
          hours: t("hours"),
          weekdays: t("weekdays"),
          minNotice: t("minNotice"),
          maxWeekly: t("maxWeekly"),
          timezone: t("timezone"),
          save: common("save"),
        }}
      />

      <div className="panel">
        <PanelTitle icon={Clock3}>{t("blackouts")}</PanelTitle>
        <form
          action={addBlackoutDate}
          style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}
        >
          <input name="date" type="date" required />
          <input
            name="reason"
            placeholder={t("blackoutReason")}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="btn secondary" type="submit">
            <UiIcon icon={Plus} size={15} />
            {t("addBlackout")}
          </button>
        </form>
        {teacher.blackoutDates.length === 0 && (
          <p className="muted" style={{ marginTop: "0.8rem" }}>
            {common("noItems")}
          </p>
        )}
        {teacher.blackoutDates.map((b) => (
          <div className="list-row" key={b.id}>
            <div>
              <div style={{ fontWeight: 700 }}>{ymdInTz(b.date, timeZone)}</div>
              <div className="muted">{b.reason || "—"}</div>
            </div>
            <form action={removeBlackoutDate}>
              <input type="hidden" name="id" value={b.id} />
              <button className="btn danger" type="submit">
                {t("remove")}
              </button>
            </form>
          </div>
        ))}
      </div>

      <div className="panel">
        <PanelTitle icon={Clock3}>{t("bookings")}</PanelTitle>
        {bookings.length === 0 && <p className="muted">{common("noItems")}</p>}
        {bookings.map((b) => (
          <div className="list-row" key={b.id}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {b.student.name} · {b.type}
              </div>
              <div className="muted">
                {formatInTz(b.requestedStart, "yyyy-MM-dd HH:mm", timeZone)} —{" "}
                {b.note || "—"}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <form action={decideBooking}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="decision" value="approve" />
                <button className="btn" type="submit">
                  <UiIcon icon={Check} size={14} />
                  {common("approve")}
                </button>
              </form>
              <form action={decideBooking}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="decision" value="decline" />
                <button className="btn danger" type="submit">
                  <UiIcon icon={X} size={14} />
                  {common("decline")}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
