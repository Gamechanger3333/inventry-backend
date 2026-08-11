import { Request, Response } from "express";

export interface PaginationParams {
  skip: number;
  take: number;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reads ?page= & ?limit= off the request, clamped to sane bounds.
 * Defaults to a capped limit even when no params are given, so a list
 * route can never accidentally return an entire (unbounded) table.
 */
export function getPagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string) || DEFAULT_LIMIT));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

/**
 * Sends the list as a plain array — exactly the shape every existing
 * frontend hook already expects, so this is a zero-breaking-change way
 * to add pagination. Total/page/limit go in response headers (same
 * convention GitHub's REST API uses), available to any caller that
 * wants to build pagination UI without forcing every consumer to change.
 */
export function sendPaginated<T>(res: Response, data: T[], total: number, { page, limit }: PaginationParams) {
  res.set({
    "X-Total-Count": String(total),
    "X-Page": String(page),
    "X-Limit": String(limit),
    "X-Total-Pages": String(Math.max(1, Math.ceil(total / limit))),
    "Access-Control-Expose-Headers": "X-Total-Count, X-Page, X-Limit, X-Total-Pages",
  });
  res.json(data);
}
