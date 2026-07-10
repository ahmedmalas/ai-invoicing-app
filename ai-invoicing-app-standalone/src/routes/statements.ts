import { createHash } from 'node:crypto';

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { generateCustomerStatementPdfBuffer } from '../services/pdf-service.js';
import { renderCustomerStatementHtml } from '../services/statement-service.js';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const statementQuerySchema = z
  .object({
    from: isoDateSchema.refine(isValidIsoCalendarDate, 'from must be a valid ISO date').optional(),
    to: isoDateSchema.refine(isValidIsoCalendarDate, 'to must be a valid ISO date').optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be less than or equal to to',
    path: ['from'],
  });

function statementSourceSignature(statement: {
  customer: { id: string };
  period: { from: string | null; to: string | null };
  openingBalance: number;
  periodTotal: number;
  closingBalance: number;
  entries: Array<{ invoiceId: string; total: number }>;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        customerId: statement.customer.id,
        period: statement.period,
        openingBalance: statement.openingBalance,
        periodTotal: statement.periodTotal,
        closingBalance: statement.closingBalance,
        entries: statement.entries,
      }),
    )
    .digest('hex');
}

export const statementRoutes: FastifyPluginAsync = async (app) => {
  app.get('/statements/customers/:customerId', async (request) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const query = statementQuerySchema.parse(request.query);

    return app.db.getCustomerStatement(params.customerId, query.from ?? null, query.to ?? null);
  });

  app.get('/statements/customers/:customerId/html', async (request, reply) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const query = statementQuerySchema.parse(request.query);
    const statement = app.db.getCustomerStatement(params.customerId, query.from ?? null, query.to ?? null);
    const html = renderCustomerStatementHtml(statement);

    return reply
      .code(200)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('X-Statement-Source-Signature', statementSourceSignature(statement))
      .header('X-Statement-Entry-Count', String(statement.entries.length))
      .send(html);
  });

  app.get('/statements/customers/:customerId/pdf', async (request, reply) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const query = statementQuerySchema.parse(request.query);
    const statement = app.db.getCustomerStatement(params.customerId, query.from ?? null, query.to ?? null);
    const businessProfile = app.db.getBusinessProfile();
    const pdfBuffer = await generateCustomerStatementPdfBuffer({
      statement,
      businessProfile,
    });

    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="statement-${params.customerId}.pdf"`)
      .header('X-Statement-Source-Signature', statementSourceSignature(statement))
      .header('X-Statement-Entry-Count', String(statement.entries.length))
      .send(pdfBuffer);
  });
};
