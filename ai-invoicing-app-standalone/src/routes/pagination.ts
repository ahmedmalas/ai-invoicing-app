import { z } from 'zod';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export interface PaginationParams {
  limit: number;
  offset: number;
}

export function parsePagination(query: unknown): PaginationParams {
  const parsed = paginationSchema.parse(query);
  return {
    limit: parsed.limit ?? 25,
    offset: parsed.offset ?? 0,
  };
}

export function paginateArray<T>(items: T[], pagination: PaginationParams): T[] {
  return items.slice(pagination.offset, pagination.offset + pagination.limit);
}
