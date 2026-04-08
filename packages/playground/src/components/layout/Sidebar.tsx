/**
 * App-level sidebar. Mirrors the FinFlow mockup `.sidebar` block.
 * Single active item ("Uniqueness Playground") with placeholder
 * disabled items so the sidebar feels like part of a larger app.
 */

export default function Sidebar() {
  return (
    <aside
      style={{
        width: "var(--sidebar-width)",
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border)",
        padding: "var(--sp-5) 0",
        overflowY: "auto",
      }}
    >
      <div style={{ marginBottom: "var(--sp-6)" }}>
        <div className="sidebar-label">WORKSTREAMS</div>
        <div className="sidebar-item active">
          <span className="sidebar-icon">🧪</span>
          <span>Uniqueness Playground</span>
        </div>
        <div className="sidebar-item" style={{ opacity: 0.4, cursor: "default" }}>
          <span className="sidebar-icon">📰</span>
          <span>Sources</span>
        </div>
        <div className="sidebar-item" style={{ opacity: 0.4, cursor: "default" }}>
          <span className="sidebar-icon">⚙️</span>
          <span>Content Pipeline</span>
        </div>
        <div className="sidebar-item" style={{ opacity: 0.4, cursor: "default" }}>
          <span className="sidebar-icon">📡</span>
          <span>Publishers</span>
        </div>
      </div>

      <div style={{ marginBottom: "var(--sp-6)" }}>
        <div className="sidebar-label">PRODUCT</div>
        <div className="sidebar-item" style={{ opacity: 0.4, cursor: "default" }}>
          <span className="sidebar-icon">📊</span>
          <span>Dashboard</span>
        </div>
        <div className="sidebar-item" style={{ opacity: 0.4, cursor: "default" }}>
          <span className="sidebar-icon">🌐</span>
          <span>Translation Engine</span>
        </div>
      </div>
    </aside>
  );
}
