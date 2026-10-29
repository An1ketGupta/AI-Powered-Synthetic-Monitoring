import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { MonitorDetail } from "../types";
import { StatusPill } from "../components/StatusPill";
import { LatencyStrip } from "../components/LatencyStrip";
import { IncidentCard } from "../components/IncidentCard";
import { RegionDots } from "../components/RegionDots";
import { formatDateTime, formatRelative } from "../lib/format";
import { useSession } from "../session";

export function MonitorDetailPage() {
  const { canWrite } = useSession();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [monitor, setMonitor] = useState<MonitorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setMonitor(await api.getMonitor(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monitor.");
    }
  }, [id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function togglePaused() {
    if (!monitor) return;
    setBusy(true);
    try {
      await api.setMonitorActive(monitor.id, monitor.is_active === 0);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update monitor.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!monitor) return;
    setBusy(true);
    try {
      await api.deleteMonitor(monitor.id);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete monitor.");
      setBusy(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!monitor) return <div className="empty">Loading…</div>;

  const uptime = computeUptime(monitor);

  return (
    <>
      <p className="muted">
        <Link to="/">← All monitors</Link>
      </p>

      <div className="monitor-row" style={{ marginBottom: "1rem" }}>
        <div className="identity">
          <h1>{monitor.name}</h1>
          <span className="url mono">
            {monitor.method} {monitor.url}
          </span>
        </div>
        <div className="right">
          <StatusPill status={monitor.live.status} paused={monitor.is_active === 0} />
        </div>
      </div>

      <div className="card">
        <div className="monitor-row">
          <div>
            <span className="label muted">Uptime (last {monitor.checks.length} checks)</span>
            <div style={{ fontSize: "1.5rem", fontWeight: 650 }}>{uptime}</div>
          </div>
          <LatencyStrip checks={monitor.checks} />
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Every {monitor.interval_seconds}s from 4 regions · incident when {monitor.region_quorum} of 4 fail ·
          expects HTTP {monitor.expected_status} · {monitor.timeout_ms}ms timeout · last checked{" "}
          {formatRelative(monitor.live.lastCheckedAt)}
        </p>
      </div>

      {canWrite && (
        <div className="card">
          <button onClick={togglePaused} disabled={busy}>
            {monitor.is_active === 0 ? "Resume checks" : "Pause checks"}
          </button>{" "}
          <button className="danger" onClick={remove} disabled={busy}>
            Delete monitor
          </button>
        </div>
      )}

      <h2>Incidents</h2>
      {monitor.incidents.length === 0 ? (
        <div className="card empty">No incidents recorded for this monitor.</div>
      ) : (
        monitor.incidents.map((incident) => (
          <div className="card" key={incident.id}>
            <IncidentCard incident={incident} />
          </div>
        ))
      )}

      <h2>Recent checks</h2>
      <div className="card scroll-x">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>HTTP</th>
              <th>Latency</th>
              <th>Regions</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {monitor.checks.slice(0, 30).map((check) => (
              <tr key={check.id}>
                <td>{formatDateTime(check.checked_at)}</td>
                <td>
                  <StatusPill status={check.status} />
                </td>
                <td className="mono">{check.http_status ?? "—"}</td>
                <td className="mono">{check.latency_ms !== null ? `${check.latency_ms}ms` : "—"}</td>
                <td>
                  <RegionDots regions={check.regions} />
                </td>
                <td className="muted" style={{ whiteSpace: "normal" }}>
                  {check.error ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function computeUptime(monitor: MonitorDetail): string {
  if (monitor.checks.length === 0) return "—";
  const up = monitor.checks.filter((c) => c.status === "up").length;
  return `${((up / monitor.checks.length) * 100).toFixed(1)}%`;
}
