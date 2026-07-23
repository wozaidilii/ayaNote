import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { decideBooking, updateAvailability } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { DEMO_TEACHER_EMAIL } from "@/lib/session";

export default async function AvailabilityPage() {
  const t = await getTranslations("availability");
  const common = await getTranslations("common");
  const teacher = await prisma.teacher.findUniqueOrThrow({
    where: { email: DEMO_TEACHER_EMAIL },
    include: { availabilityRules: true },
  });
  const rules = teacher.availabilityRules;
  const bookings = await prisma.bookingRequest.findMany({
    where: { teacherId: teacher.id, status: "pending" },
    include: { student: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell active="availability">
      <h1 className="h1">{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <form className="panel" action={updateAvailability} style={{ marginTop: "1.2rem" }}>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="startTime">{t("hours")} start</label>
            <input id="startTime" name="startTime" defaultValue={rules?.startTime ?? "10:00"} />
          </div>
          <div className="field">
            <label htmlFor="endTime">{t("hours")} end</label>
            <input id="endTime" name="endTime" defaultValue={rules?.endTime ?? "20:00"} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="minNoticeHours">{t("minNotice")}</label>
            <input
              id="minNoticeHours"
              name="minNoticeHours"
              type="number"
              defaultValue={rules?.minNoticeHours ?? 24}
            />
          </div>
          <div className="field">
            <label htmlFor="maxWeeklyLessons">{t("maxWeekly")}</label>
            <input
              id="maxWeeklyLessons"
              name="maxWeeklyLessons"
              type="number"
              defaultValue={rules?.maxWeeklyLessons ?? 6}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="weekdaysJson">{t("weekdays")} (JSON 0=Sun)</label>
          <input
            id="weekdaysJson"
            name="weekdaysJson"
            defaultValue={rules?.weekdaysJson ?? "[1,2,3,4,5,6]"}
          />
        </div>
        <button className="btn" type="submit">
          {common("save")}
        </button>
      </form>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{t("bookings")}</h2>
        {bookings.length === 0 && <p className="muted">{common("noItems")}</p>}
        {bookings.map((b) => (
          <div className="list-row" key={b.id}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {b.student.name} · {b.type}
              </div>
              <div className="muted">
                {format(b.requestedStart, "yyyy-MM-dd HH:mm")} — {b.note || "—"}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <form action={decideBooking}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="decision" value="approve" />
                <button className="btn" type="submit">
                  {common("approve")}
                </button>
              </form>
              <form action={decideBooking}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="decision" value="decline" />
                <button className="btn danger" type="submit">
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
