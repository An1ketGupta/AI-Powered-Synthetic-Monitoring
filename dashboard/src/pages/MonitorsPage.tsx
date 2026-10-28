import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Monitor, NewMonitorInput } from "../types";
import { StatusPill } from "../components/StatusPill";
import { formatRelative } from "../lib/format";

const EMPTY_FORM: NewMonitorInput = {
  name: "",
  url: "",
  method: "GET",
  expected_status: 200,
  interval_seconds: 60,
  timeout_ms: 10000,
};

export function MonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setMonitors(await api.listMonitors());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monitors.");
    }
  }

  useEffect(() => {
    load();
    // Status is written by the once-a-minute cron sweep, so polling at 15s
    // keeps the view fresh without hammering the API.
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.createMonitor(form);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create monitor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Monitors</h1>
      <p className="muted">
        Checked from Cloudflare's edge every minute. Incidents open after two consecutive failures.
      </p>

      {error && <div className="error">{error}</div>}

      <h2>Add a monitor</h2>
      <form className="card" onSubmit={handleCreate}>
        <div className="field-grid">
          <div>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Checkout API"
              required
            />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label htmlFor="url">URL</label>
            <input
              id="url"
              type="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://api.example.com/health"
              required
            />
          </div>
          <div>
            <label htmlFor="method">Method</label>
            <select
              id="method"
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            >
              <option>GET</option>
              <option>HEAD</option>
              <option>POST</option>
            </select>
          </div>
          <div>
            <label htmlFor="expected">Expected status</label>
            <input
              id="expected"
              type="number"
              value={form.expected_status}
              onChange={(e) => setForm({ ...form, expected_status: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="interval">Interval (s)</label>
            <input
              id="interval"
              type="number"
              min={60}
              step={60}
              value={form.interval_seconds}
              onChange={(e) => setForm({ ...form, interval_seconds: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="timeout">Timeout (ms)</label>
            <input
              id="timeout"
              type="number"
              min={1000}
              step={500}
              value={form.timeout_ms}
              onChange={(e) => setForm({ ...form, timeout_ms: Number(e.target.value) })}
            />
          </div>
        </div>
        <button className="primary" type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add monitor"}
        </button>
      </form>

      <h2>Watching {monitors?.length ?? 0}</h2>

      {monitors === null && <div className="empty">Loading…</div>}
      {monitors?.length === 0 && <div className="card empty">No monitors yet. Add one above to start.</div>}

      {monitors?.map((monitor) => (
        <div className="card" key={monitor.id}>
          <div className="monitor-row">
            <div className="identity">
              <strong>
                <Link to={`/monitors/${monitor.id}`}>{monitor.name}</Link>
              </strong>
              <span className="url">
                {monitor.method} {monitor.url}
              </span>
            </div>
            <div className="right">
              <span className="muted">checked {formatRelative(monitor.live.lastCheckedAt)}</span>
              <StatusPill status={monitor.live.status} paused={monitor.is_active === 0} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
