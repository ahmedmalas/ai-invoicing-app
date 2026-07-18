import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  approveMatchSchema,
  bulkMatchIdsSchema,
  bulkTransactionIdsSchema,
  createBankAccountSchema,
  importBankStatementSchema,
  manualMatchSchema,
  updateBankAccountSchema,
} from '../domain/reconciliation/index.js';

function actorFromRequest(request: {
  auth?: { userId?: string };
}): { userId?: string | null; email?: string | null } {
  return {
    userId: request.auth?.userId ?? null,
    email: null,
  };
}

function definedEntries<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export const reconciliationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/reconciliation/accounts', async () => ({
    accounts: await app.db.listBankAccounts(),
  }));

  app.post('/reconciliation/accounts', async (request, reply) => {
    const body = createBankAccountSchema.parse(request.body);
    const account = await app.db.createBankAccount({
      nickname: body.nickname,
      accountType: body.accountType,
      institution: body.institution ?? null,
      accountNumberMasked: body.accountNumberMasked ?? null,
      bsbMasked: body.bsbMasked ?? null,
      currency: body.currency,
      balance: body.balance,
      source: body.source,
      externalAccountId: body.externalAccountId ?? null,
      connectionId: body.connectionId ?? null,
    });
    return reply.code(201).send(account);
  });

  app.patch('/reconciliation/accounts/:accountId', async (request) => {
    const params = z.object({ accountId: z.string().uuid() }).parse(request.params);
    const body = updateBankAccountSchema.parse(request.body);
    return app.db.updateBankAccount(
      params.accountId,
      definedEntries({
        nickname: body.nickname,
        accountType: body.accountType,
        institution: body.institution,
        accountNumberMasked: body.accountNumberMasked,
        bsbMasked: body.bsbMasked,
        currency: body.currency,
        balance: body.balance,
        source: body.source,
        status: body.status,
        lastSyncAt: body.lastSyncAt,
        externalAccountId: body.externalAccountId,
        connectionId: body.connectionId,
      }),
    );
  });

  app.get('/reconciliation/accounts/:accountId', async (request, reply) => {
    const params = z.object({ accountId: z.string().uuid() }).parse(request.params);
    const account = await app.db.getBankAccountById(params.accountId);
    if (!account) return reply.code(404).send({ message: 'BANK_ACCOUNT_NOT_FOUND' });
    return account;
  });

  app.post('/reconciliation/import', async (request, reply) => {
    const body = importBankStatementSchema.parse(request.body);
    let content: string;
    try {
      content = Buffer.from(body.contentBase64, 'base64').toString('utf8');
    } catch {
      return reply.code(400).send({ message: 'INVALID_BASE64_CONTENT' });
    }
    if (!content.trim()) {
      return reply.code(400).send({ message: 'EMPTY_STATEMENT_CONTENT' });
    }
    const result = await app.db.importBankStatement({
      bankAccountId: body.bankAccountId,
      format: body.format,
      filename: body.filename,
      content,
      autoMatch: body.autoMatch,
      actor: actorFromRequest(request),
    });
    return reply.code(201).send(result);
  });

  app.get('/reconciliation/workspace', async (request) => {
    const query = z
      .object({
        bankAccountId: z.string().uuid().optional(),
        status: z.enum(['unmatched', 'suggested', 'matched', 'ignored']).optional(),
        search: z.string().trim().max(200).optional(),
      })
      .parse(request.query);
    return app.db.getReconciliationWorkspace(
      definedEntries({
        bankAccountId: query.bankAccountId,
        status: query.status,
        search: query.search,
      }) as {
        bankAccountId?: string;
        status?: string;
        search?: string;
      },
    );
  });

  app.get('/reconciliation/transactions', async (request) => {
    const query = z
      .object({
        bankAccountId: z.string().uuid().optional(),
        status: z.enum(['unmatched', 'suggested', 'matched', 'ignored']).optional(),
        search: z.string().trim().max(200).optional(),
        importBatchId: z.string().uuid().optional(),
      })
      .parse(request.query);
    return {
      transactions: await app.db.listBankTransactions(
        definedEntries({
          bankAccountId: query.bankAccountId,
          status: query.status,
          search: query.search,
          importBatchId: query.importBatchId,
        }) as {
          bankAccountId?: string;
          status?: string;
          search?: string;
          importBatchId?: string;
        },
      ),
    };
  });

  app.get('/reconciliation/matches', async (request) => {
    const query = z
      .object({
        bankTransactionId: z.string().uuid().optional(),
        bankAccountId: z.string().uuid().optional(),
        status: z.enum(['suggested', 'confirmed', 'rejected']).optional(),
      })
      .parse(request.query);
    return {
      matches: await app.db.listReconciliationMatches(
        definedEntries({
          bankTransactionId: query.bankTransactionId,
          bankAccountId: query.bankAccountId,
          status: query.status,
        }) as {
          bankTransactionId?: string;
          bankAccountId?: string;
          status?: string;
        },
      ),
    };
  });

  app.post('/reconciliation/matches/:matchId/approve', async (request, reply) => {
    const params = z.object({ matchId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        allocations: approveMatchSchema.shape.allocations.optional(),
      })
      .parse(request.body ?? {});
    try {
      const result = await app.db.approveReconciliationMatch(
        params.matchId,
        actorFromRequest(request),
        body.allocations,
      );
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RECONCILIATION_APPROVE_FAILED';
      return reply.code(400).send({ message });
    }
  });

  app.post('/reconciliation/matches/bulk-approve', async (request, reply) => {
    const body = bulkMatchIdsSchema.parse(request.body);
    const actor = actorFromRequest(request);
    const results = [];
    const errors = [];
    for (const matchId of body.matchIds) {
      try {
        results.push(await app.db.approveReconciliationMatch(matchId, actor));
      } catch (error) {
        errors.push({
          matchId,
          message: error instanceof Error ? error.message : 'FAILED',
        });
      }
    }
    return reply.send({ approved: results.length, results, errors });
  });

  app.post('/reconciliation/manual-match', async (request, reply) => {
    const body = manualMatchSchema.parse(request.body);
    try {
      const result = await app.db.manualReconciliationMatch(
        definedEntries({
          bankTransactionId: body.bankTransactionId,
          customerId: body.customerId,
          allocations: body.allocations,
          paymentMethod: body.paymentMethod,
          reference: body.reference,
          notes: body.notes,
        }) as {
          bankTransactionId: string;
          customerId: string;
          allocations: Array<{ invoiceId: string; amount: number }>;
          paymentMethod?: string;
          reference?: string;
          notes?: string;
        },
        actorFromRequest(request),
      );
      return reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RECONCILIATION_MANUAL_MATCH_FAILED';
      return reply.code(400).send({ message });
    }
  });

  app.post('/reconciliation/transactions/ignore', async (request) => {
    const body = bulkTransactionIdsSchema.parse(request.body);
    const count = await app.db.ignoreBankTransactions(
      body.transactionIds,
      actorFromRequest(request),
    );
    return { ignored: count };
  });

  app.post('/reconciliation/transactions/:transactionId/unmatch', async (request, reply) => {
    const params = z.object({ transactionId: z.string().uuid() }).parse(request.params);
    try {
      const txn = await app.db.unmatchBankTransaction(
        params.transactionId,
        actorFromRequest(request),
      );
      return txn;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RECONCILIATION_UNMATCH_FAILED';
      return reply.code(400).send({ message });
    }
  });

  app.post('/reconciliation/transactions/:transactionId/rematch', async (request, reply) => {
    const params = z.object({ transactionId: z.string().uuid() }).parse(request.params);
    try {
      const txn = await app.db.rematchBankTransaction(
        params.transactionId,
        actorFromRequest(request),
      );
      return txn;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RECONCILIATION_REMATCH_FAILED';
      return reply.code(400).send({ message });
    }
  });

  app.get('/reconciliation/audit', async (request) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    return { audit: await app.db.listReconciliationAudit(query.limit) };
  });

  app.get('/reconciliation/reports', async () => app.db.getReconciliationReport());
};
