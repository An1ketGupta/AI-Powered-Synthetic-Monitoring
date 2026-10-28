import { DurableObject } from "cloudflare:workers";
import type { CheckResult } from "../types";
import {
  applyCheckResult,
  INITIAL_STATE,
  type MonitorRuntimeState,
  type StateMachineAction,
} from "./state-machine";

const STATE_KEY = "runtime_state";

/**
 * One MonitorState Durable Object instance per monitored URL (keyed by
 * `idFromName(monitorId)`). It owns exactly one job: deciding, with strong
 * consistency and no race conditions, whether a new check result opens,
 * escalates, or resolves an incident. Durable, I/O-heavy work (writing
 * history to D1, generating an AI summary, Vectorize similarity search,
 * queuing an alert) deliberately happens back in the Worker after this
 * call returns, so this hot path stays fast regardless of AI/D1 latency.
 */
export class MonitorState extends DurableObject<Env> {
  async process(
    result: CheckResult,
    consecutiveFailuresForIncident: number
  ): Promise<{ action: StateMachineAction; status: MonitorRuntimeState["status"] }> {
    const current = (await this.ctx.storage.get<MonitorRuntimeState>(STATE_KEY)) ?? INITIAL_STATE;

    const { state, action } = applyCheckResult(current, result, {
      consecutiveFailuresForIncident,
      newIncidentId: () => crypto.randomUUID(),
    });

    await this.ctx.storage.put(STATE_KEY, state);

    return { action, status: state.status };
  }

  async getState(): Promise<MonitorRuntimeState> {
    return (await this.ctx.storage.get<MonitorRuntimeState>(STATE_KEY)) ?? INITIAL_STATE;
  }

  /** Used when a monitor is deleted so a recreated monitor with a reused id starts clean. */
  async reset(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
