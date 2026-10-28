import type { Incident, Monitor, MonitorDetail, NewMonitorInput } from "./types";

const TOKEN_KEY = "edgewatch_api_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) throw new UnauthorizedError("Invalid or missing API token.");

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listMonitors: () => request<Monitor[]>("/monitors"),
  getMonitor: (id: string) => request<MonitorDetail>(`/monitors/${id}`),
  createMonitor: (input: NewMonitorInput) =>
    request<Monitor>("/monitors", { method: "POST", body: JSON.stringify(input) }),
  setMonitorActive: (id: string, isActive: boolean) =>
    request<Monitor>(`/monitors/${id}`, { method: "PUT", body: JSON.stringify({ is_active: isActive }) }),
  deleteMonitor: (id: string) => request<void>(`/monitors/${id}`, { method: "DELETE" }),
  listIncidents: (status?: "open" | "resolved") =>
    request<Incident[]>(`/incidents${status ? `?status=${status}` : ""}`),
};
