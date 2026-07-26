import type { BankStore } from '../../db/bank-store.js';
import { listBasiqJobs } from '../../services/basiq-client.js';
import {
  BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
  BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
  classifyBasiqHostedError,
  isBasiqConnectionsNotEnabledError,
} from './basiq-errors.js';
import type { BankConnection } from './types.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function collectJobText(job: unknown): string {
  const record = asRecord(job);
  const parts: string[] = [];
  for (const key of ['status', 'title', 'detail', 'code', 'message', 'type']) {
    const value = record[key];
    if (typeof value === 'string') parts.push(value);
  }
  const steps = Array.isArray(record.steps) ? record.steps : [];
  for (const step of steps) {
    const stepRecord = asRecord(step);
    const result = asRecord(stepRecord.result);
    for (const key of ['status', 'title', 'detail', 'code', 'message', 'type']) {
      const value = stepRecord[key] ?? result[key];
      if (typeof value === 'string') parts.push(value);
    }
  }
  return parts.join(' ');
}

export async function applyBasiqHostedFailure(
  store: BankStore,
  businessId: string,
  input: {
    code?: string | null | undefined;
    title?: string | null | undefined;
    detail?: string | null | undefined;
    message?: string | null | undefined;
    error?: string | null | undefined;
    errorDescription?: string | null | undefined;
  },
): Promise<BankConnection | null> {
  const connection = await store.getConnectionByBusiness(businessId);
  if (!connection || connection.status === 'disconnected') return null;
  const classified = classifyBasiqHostedError(input);
  await store.updateConnectionFields(businessId, connection.id, {
    status: 'error',
    errorCode: classified.connectionsNotEnabled
      ? BASIQ_CONNECTIONS_NOT_ENABLED_CODE
      : 'BASIQ_HOSTED_ERROR',
    errorMessage: classified.message,
  });
  return store.getConnectionById(businessId, connection.id);
}

/** Inspect recent Basiq jobs for hosted Consent UI failures (Connections not enabled). */
export async function reconcileBasiqHostedJobFailures(
  store: BankStore,
  businessId: string,
): Promise<BankConnection | null> {
  const connection = await store.getConnectionByBusiness(businessId);
  if (!connection?.providerUserId) return null;
  if (connection.status !== 'connecting' && connection.status !== 'error') return null;
  if (connection.errorCode === BASIQ_CONNECTIONS_NOT_ENABLED_CODE) return connection;

  try {
    const jobs = await listBasiqJobs(connection.providerUserId, { limit: 10 });
    for (const job of jobs) {
      const text = collectJobText(job);
      if (
        isBasiqConnectionsNotEnabledError({
          message: text,
          detail: text,
          title: text,
        })
      ) {
        await store.updateConnectionFields(businessId, connection.id, {
          status: 'error',
          errorCode: BASIQ_CONNECTIONS_NOT_ENABLED_CODE,
          errorMessage: BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
        });
        console.info(
          JSON.stringify({
            service: 'basiq-connect',
            event: 'basiq.hosted.connections_not_enabled',
            providerUserId: connection.providerUserId,
            source: 'jobs',
          }),
        );
        return store.getConnectionById(businessId, connection.id);
      }
    }
  } catch {
    // Jobs listing may itself be denied — leave connection unchanged.
  }
  return connection;
}
