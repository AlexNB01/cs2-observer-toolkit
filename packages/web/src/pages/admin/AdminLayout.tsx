import { NavLink, Outlet } from "react-router-dom";

const NAV_GROUPS: { label: string; items: { to: string; label: string }[] }[] = [
  { label: "Setup", items: [{ to: "setup", label: "GSI Setup" }] },
  {
    label: "Producing",
    items: [
      { to: "observer", label: "Smart Auto Observer" },
      { to: "hlae", label: "HLAE" },
    ],
  },
];

export function AdminLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>CS2 Observer Toolkit</h1>
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
