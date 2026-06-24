/**
 * Standard API response contract.
 * All server endpoints return this shape — even errors.
 */
export interface ApiResponse<T = any> {
  status: number;
  data: T;
  message?: string;
  pagination?: ApiPagination;
}

export interface ApiPagination {
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  nextCursor?: string | null;
}
