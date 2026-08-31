import "dotenv/config";
import { createServer } from "http";
import app from "./app";
import prisma from "./lib/prisma";
import { initRealtime } from "./lib/realtime";

const port = Number(process.env.PORT) || 8080;

async function main() {
  // Test DB connection on startup
  try {
    await prisma.$connect();
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  }

  // Socket.io needs the raw http.Server (not the Express app directly) so
  // it can upgrade the same port to WebSocket connections for real-time
  // low-stock notifications.
  const server = createServer(app);
  initRealtime(server);

  server.listen(port, () => {
    console.log(`🚀 Nexus backend running on http://localhost:${port}`);
    console.log(`📡 API available at http://localhost:${port}/api`);
    console.log(`🔍 Health check: http://localhost:${port}/api/healthz`);
    console.log(`🔌 Realtime (Socket.io) attached to the same port`);
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down...");
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("SIGINT received, shutting down...");
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
