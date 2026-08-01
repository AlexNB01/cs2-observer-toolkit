import { NavLink, Outlet } from "react-router-dom";

const NAV_GROUPS: { label: string; items: { to: string; label: string }[] }[] = [
  { label: "Setup", items: [{ to: "setup", label: "GSI Setup" }] },
  {
    label: "HUD",
    items: [
      { to: "hud-display", label: "HUD" },
      { to: "minimap", label: "MiniMap" },
    ],
  },
  {
    label: "Producing",
    items: [
      { to: "observer", label: "Smart Auto Observer" },
      { to: "stats", label: "Player stats" },
      { to: "obs", label: "OBS replay" },
      { to: "hlae", label: "HLAE" },
      { to: "veto", label: "Veto / map pick" },
    ],
  },
  {
    label: "Roster",
    items: [
      { to: "players", label: "Players" },
      { to: "teams", label: "Teams" },
    ],
  },
];

export function AdminLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>CS2 HUD Tool</h1>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="sidebar-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
