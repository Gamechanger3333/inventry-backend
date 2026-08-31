import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken, AUTH_COOKIE } from "../middleware/auth";
import prisma from "./prisma";

let io: Server | null = null;

/** Pulls a named cookie out of a raw `Cookie` header without pulling in a
 *  full cookie-parsing dependency just for this one handshake step. */
function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Real-time layer for dashboard/notification pushes (currently: low-stock
 * alerts). Every connection authenticates off the same httpOnly auth
 * cookie the REST API uses, then joins a room scoped to its organization
 * so one tenant's stock events are never broadcast to another tenant's
 * connected clients.
 */
export function initRealtime(server: HttpServer): Server {
  const isProd = process.env.NODE_ENV === "production";
  const configuredOrigin = process.env.FRONTEND_URL;

  io = new Server(server, {
    cors: {
      credentials: true,
      origin: isProd
        ? configuredOrigin
        : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
              callback(null, true);
            } else {
              callback(new Error("Not allowed by CORS"));
            }
          },
    },
  });

  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, AUTH_COOKIE);
      if (!token) return next(new Error("Unauthorized"));
      const payload = verifyToken(token);
      if (!payload) return next(new Error("Unauthorized"));
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, organizationId: true },
      });
      if (!user) return next(new Error("Unauthorized"));
      socket.data.organizationId = user.organizationId;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.join(`org:${socket.data.organizationId}`);
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}
