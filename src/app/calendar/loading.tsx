export default function CalendarLoading() {
  return (
    <div className="shell">
      <aside className="sidebar" aria-hidden>
        <div className="skeleton-line" style={{ width: "70%", height: 22, marginBottom: 18 }} />
        <div className="skeleton-line" style={{ width: "50%", height: 12, marginBottom: 28 }} />
        <div className="skeleton-line" style={{ width: "80%", height: 14, marginBottom: 10 }} />
      </aside>
      <main className="main">
        <div className="doc-page">
          <div className="panel">
            <div className="skeleton-line" style={{ width: "40%", height: 28, marginBottom: 12 }} />
            <div className="skeleton-line" style={{ width: "70%", height: 14, marginBottom: 24 }} />
            <div className="skeleton-line" style={{ width: "100%", height: 72 }} />
          </div>
        </div>
      </main>
    </div>
  );
}
