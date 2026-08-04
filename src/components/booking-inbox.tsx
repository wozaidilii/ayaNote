import { decideBooking } from "@/app/actions";
import { formatInTz } from "@/lib/timezone";

export type PendingBookingRow = {
  id: string;
  type: string;
  note: string;
  studentName: string;
  requestedStart: Date;
};

export function BookingInbox({
  bookings,
  timeZone,
  returnTo,
  labels,
}: {
  bookings: PendingBookingRow[];
  timeZone: string;
  returnTo: string;
  labels: {
    title: string;
    empty: string;
    approve: string;
    decline: string;
  };
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>{labels.title}</h2>
        <span className={`chip ${bookings.length ? "soon" : ""}`}>{bookings.length}</span>
      </div>
      {bookings.length === 0 ? (
        <p className="muted">{labels.empty}</p>
      ) : (
        bookings.map((b) => (
          <div className="list-row" key={b.id}>
            <div className="list-row-main">
              <div className="list-row-title">
                {b.studentName} · {b.type}
              </div>
              <div className="list-row-meta">
                {formatInTz(b.requestedStart, "yyyy-MM-dd HH:mm", timeZone)} — {b.note || "—"}
              </div>
            </div>
            <div className="list-row-actions">
              <form action={decideBooking}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="decision" value="approve" />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="btn sm" type="submit">
                  {labels.approve}
                </button>
              </form>
              <form action={decideBooking}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="decision" value="decline" />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="btn danger sm" type="submit">
                  {labels.decline}
                </button>
              </form>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
