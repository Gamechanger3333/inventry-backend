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
    name: string;
    email: string;
    role: string;
    avatar: string | null;
    createdAt: Date;
    updatedAt: Date;
    emailVerified: boolean;
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

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
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
