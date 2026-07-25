import { createHash, randomUUID } from 'node:crypto';

import type { AppDatabase } from '../db/database.js';
import type {
  AgentVisibleState,
  AleyaToolContext,
  PendingConfirmation,
  ToolResult,
  UndoEntry,
} from './types.js';

const UNDO_PREF = 'aleya_ai_undo_v1';

interface StoredUndo {
  id: string;
  toolName: string;
  createdAt: string;
  label: string;
  kind: 'invoice_snapshot' | 'customer_snapshot';
  payload: unknown;
}

async function loadUndos(db: AppDatabase, conversationId: string): Promise<StoredUndo[]> {
  const bag = (await db.getPreference(UNDO_PREF)) as Record<string, StoredUndo[]> | null;
  return bag?.[conversationId] || [];
}

async function saveUndos(
  db: AppDatabase,
  conversationId: string,
  entries: StoredUndo[],
): Promise<void> {
  const bag = ((await db.getPreference(UNDO_PREF)) as Record<string, StoredUndo[]> | null) || {};
  bag[conversationId] = entries.slice(-30);
  await db.upsertPreference(UNDO_PREF, bag);
}

export function createToolContext(options: {
  db: AppDatabase;
  userId: string;
  organizationId: string;
  conversationId: string;
  visibleState?: AgentVisibleState;
  approvedTokens?: Iterable<string>;
  onConfirmation?: (pending: PendingConfirmation) => void;
}): AleyaToolContext {
  const approvedTokens = new Set(options.approvedTokens || []);
  let lastPending: PendingConfirmation | null = null;

  const ctx: AleyaToolContext = {
    db: options.db,
    userId: options.userId,
    organizationId: options.organizationId,
    conversationId: options.conversationId,
    visibleState: options.visibleState || {},
    approvedTokens,
    now: () => new Date(),
    requestConfirmation(toolName, input, summary) {
      const hash = createHash('sha256')
        .update(JSON.stringify({ toolName, input }))
        .digest('hex')
        .slice(0, 16);
      const token = `${toolName}::${hash}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      lastPending = {
        token,
        toolName,
        input,
        summary,
        createdAt,
        expiresAt,
      };
      options.onConfirmation?.(lastPending);
      return lastPending;
    },
    async pushUndo(entry) {
      const id = entry.id || randomUUID();
      // Undo restore functions are rehydrated from stored snapshots in tools.
      const stored = entry as UndoEntry & { kind?: StoredUndo['kind']; payload?: unknown };
      if (!stored.kind || stored.payload === undefined) {
        // Runtime-only undo (in-memory restore closure) — store a marker.
        const list = await loadUndos(options.db, options.conversationId);
        list.push({
          id,
          toolName: entry.toolName,
          createdAt: new Date().toISOString(),
          label: entry.label,
          kind: 'invoice_snapshot',
          payload: { runtime: true },
        });
        await saveUndos(options.db, options.conversationId, list);
        runtimeRestores.set(id, entry.restore);
        return id;
      }
      const list = await loadUndos(options.db, options.conversationId);
      list.push({
        id,
        toolName: entry.toolName,
        createdAt: new Date().toISOString(),
        label: entry.label,
        kind: stored.kind,
        payload: stored.payload,
      });
      await saveUndos(options.db, options.conversationId, list);
      return id;
    },
    async undoLast() {
      return undoLastAction(options.db, options.conversationId);
    },
    async logAudit(event, payload) {
      try {
        const key = 'aleya_ai_audit_v1';
        const existing = ((await options.db.getPreference(key)) as Array<Record<string, unknown>>) || [];
        existing.push({
          at: new Date().toISOString(),
          event,
          conversationId: options.conversationId,
          userId: options.userId,
          organizationId: options.organizationId,
          ...payload,
        });
        await options.db.upsertPreference(key, existing.slice(-200));
      } catch {
        // Audit must never block tool execution.
      }
    },
  };

  return ctx;
}

const runtimeRestores = new Map<string, () => Promise<void>>();

export async function pushInvoiceUndoSnapshot(
  ctx: AleyaToolContext,
  invoiceId: string,
  label: string,
  toolName: string,
): Promise<void> {
  const invoice = await ctx.db.getInvoiceById(invoiceId);
  if (!invoice) return;
  const id = randomUUID();
  const list = await loadUndos(ctx.db, ctx.conversationId);
  list.push({
    id,
    toolName,
    createdAt: new Date().toISOString(),
    label,
    kind: 'invoice_snapshot',
    payload: invoice,
  });
  await saveUndos(ctx.db, ctx.conversationId, list);
}

export async function undoLastAction(
  db: AppDatabase,
  conversationId: string,
): Promise<ToolResult> {
  const list = await loadUndos(db, conversationId);
  const last = list.pop();
  if (!last) {
    return { ok: false, code: 'NOTHING_TO_UNDO', message: 'No reversible Aleya AI edit to undo.' };
  }
  await saveUndos(db, conversationId, list);

  if (runtimeRestores.has(last.id)) {
    await runtimeRestores.get(last.id)!();
    runtimeRestores.delete(last.id);
    return {
      ok: true,
      data: { undoId: last.id },
      summary: `Undid: ${last.label}`,
      ui: { refresh: ['invoices', 'customers'] },
    };
  }

  if (last.kind === 'invoice_snapshot') {
    const snapshot = last.payload as {
      id: string;
      title: string;
      issueDate: string;
      dueDate: string;
      notes?: string | null;
      paymentTerms?: string | null;
      paymentState: 'Draft' | 'Sent' | 'Awaiting Payment' | 'Paid' | 'Cancelled';
      status: string;
      lineItems: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        gstApplicable: boolean;
        productId?: string | null;
      }>;
    };
    if (snapshot.status !== 'Draft') {
      return {
        ok: false,
        code: 'UNDO_NOT_POSSIBLE',
        message: 'Cannot undo changes to a finalised invoice snapshot.',
      };
    }
    await db.updateInvoiceDraft(snapshot.id, {
      title: snapshot.title,
      issueDate: snapshot.issueDate,
      dueDate: snapshot.dueDate,
      notes: snapshot.notes || undefined,
      paymentTerms: snapshot.paymentTerms || undefined,
      paymentState: snapshot.paymentState,
      lineItems: snapshot.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        gstApplicable: item.gstApplicable,
        productId: item.productId ?? null,
      })),
    });
    return {
      ok: true,
      data: { invoiceId: snapshot.id, undoId: last.id },
      summary: `Restored invoice draft from undo: ${last.label}`,
      ui: { refresh: ['invoices'], focusInvoiceId: snapshot.id },
    };
  }

  if (last.kind === 'customer_snapshot') {
    const snapshot = last.payload as {
      id: string;
      displayName: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      abnTaxId?: string | null;
      notes?: string | null;
    };
    await db.updateCustomer(snapshot.id, {
      displayName: snapshot.displayName,
      email: snapshot.email || undefined,
      phone: snapshot.phone || undefined,
      address: snapshot.address || undefined,
      abnTaxId: snapshot.abnTaxId || undefined,
      notes: snapshot.notes || undefined,
    });
    return {
      ok: true,
      data: { customerId: snapshot.id, undoId: last.id },
      summary: `Restored customer from undo: ${last.label}`,
      ui: { refresh: ['customers'], focusCustomerId: snapshot.id },
    };
  }

  return { ok: false, code: 'UNDO_UNSUPPORTED', message: 'This undo entry cannot be restored.' };
}

export function approveConfirmationToken(
  pending: PendingConfirmation | null | undefined,
  token: string | undefined,
  approvedTokens: Set<string>,
): void {
  if (!token) return;
  approvedTokens.add(token);
  if (pending?.token === token) {
    approvedTokens.add(pending.toolName);
    approvedTokens.add(`${pending.toolName}::*`);
  }
}
