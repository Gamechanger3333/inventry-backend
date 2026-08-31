import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma";

// A hardcoded fallback secret is a serious security hole (anyone who reads
// the source code - or the public GitHub repo - can forge valid tokens).
// Only allow the fallback outside of production, and fail loudly so a
// missing JWT_SECRET can't go unnoticed in a real deployment.
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable must be set in production");
  }
  console.warn("⚠️  JWT_SECRET not set - using an insecure development-only default. Set JWT_SECRET in your .env file.");
  return "nexus-dev-only-insecure-secret";
})();

export interface AuthRequest extends Request {
  user?: {
    id: number;
    organizationId: number;
    name: string;
    email: string;
    role: string;
    avatar: string | null;
    createdAt: Date;
    updatedAt: Date;
    emailVerified: boolean;
  };
}

export const AUTH_COOKIE = "nexus_token";
export const CSRF_COOKIE = "nexus_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** Cookie options shared by every place we set/clear the auth cookie. */
export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax" (not "strict") so the cookie still rides along on a top-level
    // navigation from an external link into the app; it still isn't sent
    // on cross-site XHR/fetch, which is the case that actually matters for
    // CSRF - that's what the separate CSRF token below is for.
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches the JWT's own expiry
  };
}

export function signToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }
}

/**
 * Auth now lives in an httpOnly cookie instead of `localStorage` + a
 * Bearer header. A JS-readable token (localStorage or a non-httpOnly
 * cookie) means any successful XSS anywhere in the app is a full account
 * takeover - the attacker's injected script can just read it. An httpOnly
 * cookie can't be read by JS at all, so XSS alone no longer yields the
 * token. The trade-off is that the browser now attaches this cookie
 * automatically to *any* request to this origin, which opens the door to
 * CSRF - see verifyCsrf below, which closes it back up.
 */
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  // Select only the fields routes actually need - in particular, never
  // load passwordHash onto req.user. It doesn't need to exist in memory
  // past the login/register handlers, and keeping it off this object means
  // a stray `res.json(req.user)` somewhere can never leak it.
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      email: true,
      role: true,
      avatar: true,
      createdAt: true,
      updatedAt: true,
      emailVerified: true,
    },
  });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  req.user = user;
  next();
}

/**
 * Double-submit CSRF check. On login/register we set a second, *readable*
 * cookie (CSRF_COOKIE) containing a random token, and the frontend is
 * expected to echo it back in the X-CSRF-Token header on every mutating
 * request. A cross-site page can make the browser send our httpOnly auth
 * cookie automatically, but it cannot read CSRF_COOKIE (different origin,
 * same-origin cookie policy) and so cannot reproduce the header. Apply
 * this after requireAuth on every POST/PUT/PATCH/DELETE route.
 */
export function verifyCsrf(req: AuthRequest, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: "Invalid or missing CSRF token" });
    return;
  }
  next();
}

/**
 * RBAC gate — use *after* requireAuth. Administrator always passes,
 * since it's the superset role; every other role must appear in the
 * allowed list for this route. Previously `role` was stored and returned
 * to the client but never actually checked anywhere, so every logged-in
 * user — regardless of role — had identical access to every route. This
 * is what actually enforces the permission model described at signup.
 */
export function requireRole(...allowed: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    if (!role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (role === "Administrator" || allowed.includes(role)) {
      next();
      return;
    }
    res.status(403).json({ error: `This action requires one of these roles: ${allowed.join(", ")}` });
  };
}
