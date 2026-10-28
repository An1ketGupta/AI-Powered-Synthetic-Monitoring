import { useEffect, useState } from "react";
import { api } from "../api";
import type { Incident } from "../types";
import { IncidentCard } from "../components/IncidentCard";

type Filter = "all" | "open" | "resolved";

export function IncidentsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.listIncidents(filter === "all" ? undefined : filter);
        if (!cancelled) {
          setIncidents(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load incidents.");
      }
    }

    setIncidents(null);
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [filter]);

  return (
    <>
      <h1>Incidents</h1>
      <p className="muted">
        Each incident note is written by Workers AI from the check history, and cross-referenced against
        similar past incidents via Vectorize.
      </p>

      {error && <div className="error">{error}</div>}

      <nav className="tabs" style={{ margin: "1rem 0" }}>
        {(["all", "open", "resolved"] as const).map((value) => (
          <a
            key={value}
            href="#"
            className={filter === value ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              setFilter(value);
            }}
          >
            {value}
          </a>
        ))}
      </nav>

      {incidents === null && <div className="empty">Loading…</div>}
      {incidents?.length === 0 && (
        <div className="card empty">
          No {filter === "all" ? "" : filter} incidents. Everything has been healthy.
        </div>
      )}

      {incidents?.map((incident) => (
        <div className="card" key={incident.id}>
          <IncidentCard incident={incident} showMonitor />
        </div>
      ))}
    </>
  );
}
