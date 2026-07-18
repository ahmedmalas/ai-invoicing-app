import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  createExpenseSchema,
  updateExpenseSchema,
} from '../domain/expenses/types.js';

export const expenseRoutes: FastifyPluginAsync = async (app) => {
  app.get('/expenses', async () => {
    const expenses = await app.db.listExpenses();
    return { expenses, count: expenses.length };
  });

  app.get('/expenses/:expenseId', async (request, reply) => {
    const params = z.object({ expenseId: z.string().uuid() }).parse(request.params);
    const expense = await app.db.getExpenseById(params.expenseId);
    if (!expense) return reply.code(404).send({ message: 'EXPENSE_NOT_FOUND' });
    return expense;
  });

  app.post('/expenses', async (request, reply) => {
    const body = createExpenseSchema.parse(request.body);
    const expense = await app.db.createExpense(body);
    return reply.code(201).send(expense);
  });

  app.patch('/expenses/:expenseId', async (request, reply) => {
    const params = z.object({ expenseId: z.string().uuid() }).parse(request.params);
    const body = updateExpenseSchema.parse(request.body);
    try {
      return await app.db.updateExpense(params.expenseId, body);
    } catch (error) {
      if (error instanceof Error && error.message === 'EXPENSE_NOT_FOUND') {
        return reply.code(404).send({ message: 'EXPENSE_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.delete('/expenses/:expenseId', async (request, reply) => {
    const params = z.object({ expenseId: z.string().uuid() }).parse(request.params);
    try {
      await app.db.deleteExpense(params.expenseId);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'EXPENSE_NOT_FOUND') {
        return reply.code(404).send({ message: 'EXPENSE_NOT_FOUND' });
      }
      throw error;
    }
  });
};
