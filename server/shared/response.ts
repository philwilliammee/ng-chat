import type { Context } from 'hono';

// --- Response types ---

export interface ApiResponse<T> {
  status: number;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ErrorResponse {
  status: number;
  message: string;
}

// --- Response helpers ---

export function ok<T>(c: Context, data: T, message?: string) {
  return c.json({ status: 200, data, ...(message && { message }) } satisfies ApiResponse<T>, 200);
}

export function created<T>(c: Context, data: T, message?: string) {
  return c.json({ status: 201, data, ...(message && { message }) } satisfies ApiResponse<T>, 201);
}

export function paginated<T>(
  c: Context,
  data: T[],
  pagination: { total: number; page: number; pageSize: number },
) {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);
  return c.json(
    {
      status: 200,
      data,
      pagination: { ...pagination, totalPages },
    } satisfies PaginatedResponse<T>,
    200,
  );
}

export function notFound(c: Context, message = 'Not found') {
  return c.json({ status: 404, message } satisfies ErrorResponse, 404);
}

export function badRequest(c: Context, message = 'Bad request') {
  return c.json({ status: 400, message } satisfies ErrorResponse, 400);
}

export function error(c: Context, status: number, message: string) {
  return c.json({ status, message } satisfies ErrorResponse, status as any);
}
