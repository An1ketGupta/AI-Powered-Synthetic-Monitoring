import { useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { clearToken, getToken, setToken } from "./api";
import { MonitorsPage } from "./pages/MonitorsPage";
import { MonitorDetailPage } from "./pages/MonitorDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";

export function App() {
  const [token, setTokenState] = useState(getToken());

  if (!token) return <TokenGate onSave={setTokenState} />;

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          EdgeWatch <span>synthetic monitoring on Cloudflare</span>
        </Link>
        <nav className="tabs">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Monitors
          </NavLink>
          <NavLink to="/incidents" className={({ isActive }) => (isActive ? "active" : "")}>
            Incidents
          </NavLink>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              clearToken();
              setTokenState(null);
            }}
          >
            Sign out
          </a>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<MonitorsPage />} />
        <Route path="/monitors/:id" element={<MonitorDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
      </Routes>
    </div>
  );
}

function TokenGate({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="layout">
      <form
        className="card gate"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return;
          setToken(trimmed);
          onSave(trimmed);
        }}
      >
        <h1>EdgeWatch</h1>
        <p className="muted">
          Enter the API token you set with <code className="mono">wrangler secret put API_TOKEN</code>.
        </p>
        <label htmlFor="token">API token</label>
        <input
          id="token"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button className="primary" type="submit" style={{ marginTop: "0.9rem" }}>
          Continue
        </button>
      </form>
    </div>
  );
}
