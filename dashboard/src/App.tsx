import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { api, clearToken, getToken, setToken } from "./api";
import { SessionProvider } from "./session";
import { MonitorsPage } from "./pages/MonitorsPage";
import { MonitorDetailPage } from "./pages/MonitorDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [publicReadOnly, setPublicReadOnly] = useState<boolean | null>(null);
  const [showTokenGate, setShowTokenGate] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then((config) => setPublicReadOnly(config.publicReadOnly))
      .catch(() => setPublicReadOnly(false));
  }, []);

  // Wait for the config before rendering: showing the token gate to someone
  // who could have browsed the public demo would be the wrong first impression.
  if (publicReadOnly === null) {
    return (
      <div className="layout">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const needsToken = !token && !publicReadOnly;
  if (needsToken || showTokenGate) {
    return (
      <TokenGate
        dismissible={publicReadOnly}
        onDismiss={() => setShowTokenGate(false)}
        onSave={(value) => {
          setTokenState(value);
          setShowTokenGate(false);
        }}
      />
    );
  }

  return (
    <SessionProvider value={{ canWrite: Boolean(token) }}>
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
            {token ? (
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
            ) : (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowTokenGate(true);
                }}
              >
                Admin sign in
              </a>
            )}
          </nav>
        </header>

        {!token && (
          <div className="banner">
            <strong>Live read-only demo.</strong> These monitors are really being checked from
            Cloudflare's edge every minute, and the incident notes below were written by Workers AI.
            Adding or changing monitors requires the API token.
          </div>
        )}

        <Routes>
          <Route path="/" element={<MonitorsPage />} />
          <Route path="/monitors/:id" element={<MonitorDetailPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
        </Routes>
      </div>
    </SessionProvider>
  );
}

function TokenGate({
  onSave,
  dismissible,
  onDismiss,
}: {
  onSave: (token: string) => void;
  dismissible: boolean;
  onDismiss: () => void;
}) {
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
        <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem" }}>
          <button className="primary" type="submit">
            Continue
          </button>
          {dismissible && (
            <button type="button" onClick={onDismiss}>
              Back to demo
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
