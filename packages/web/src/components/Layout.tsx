import { useAuth } from "react-oidc-context";
import { NavLink, Outlet } from "react-router-dom";
import { signOut, useConfig } from "../auth";
import { useInbox } from "../hooks";

const NAV = [
  { to: "/inbox", label: "Inbox", icon: "📥" },
  { to: "/capture", label: "Capture", icon: "📷" },
  { to: "/expenses", label: "Expenses", icon: "🗂️" },
  { to: "/reports", label: "Reports", icon: "📊" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

export function Layout() {
  const auth = useAuth();
  const config = useConfig();
  const inbox = useInbox();
  const pending = inbox.items.filter((e) => e.status === "needs_review" || e.status === "failed").length;
  const email = (auth.user?.profile["email"] as string | undefined) ?? "";

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/inbox" className="brand">
          <img src="/icons/icon.svg" alt="" width={28} height={28} /> <span>Simple Expenses</span>
        </NavLink>
        <nav className="nav desktop-only">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.label}
              {n.to === "/inbox" && pending > 0 && <span className="badge">{pending}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <span className="desktop-only muted">{email}</span>
          <button className="btn small" onClick={() => void signOut(config, () => auth.removeUser())}>Sign out</button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <nav className="tabbar mobile-only">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="icon" aria-hidden>{n.icon}</span>
            <span>{n.label}</span>
            {n.to === "/inbox" && pending > 0 && <span className="badge">{pending}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
