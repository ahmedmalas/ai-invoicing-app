export type LatencyMark =
  | 'request_received'
  | 'auth_completed'
  | 'context_loaded'
  | 'status_intent_matched'
  | 'model_request_started'
  | 'model_finished'
  | 'tool_selected'
  | 'tool_started'
  | 'tool_finished'
  | 'follow_up_model_started'
  | 'final_response_ready'
  | 'persistence_completed';

export interface LatencyEvent {
  mark: LatencyMark | string;
  atMs: number;
  detail?: Record<string, unknown>;
}

export class LatencyTrace {
  readonly startedAt = Date.now();
  readonly events: LatencyEvent[] = [];

  mark(mark: LatencyMark | string, detail?: Record<string, unknown>): void {
    this.events.push({
      mark,
      atMs: Date.now() - this.startedAt,
      ...(detail ? { detail } : {}),
    });
  }

  toJSON(): {
    totalMs: number;
    events: LatencyEvent[];
  } {
    return {
      totalMs: Date.now() - this.startedAt,
      events: this.events,
    };
  }
}

export function latencyTraceEnabled(requestHeaders?: Record<string, unknown> | null): boolean {
  if (process.env.ALEYA_AI_LATENCY_TRACE === '1') return true;
  if (!requestHeaders) return false;
  const value =
    requestHeaders['x-aleya-debug-latency'] ||
    requestHeaders['X-Aleya-Debug-Latency'] ||
    requestHeaders['x-aleya-debug-latency'.toLowerCase()];
  return value === '1' || value === 'true';
}
