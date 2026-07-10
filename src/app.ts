import express from "express";
import cors from "cors";
import morgan from "morgan";
import router from "./routes";

const app = express();

// Middleware
// origin: "*" together with credentials: true is rejected by browsers (and
// defeats the purpose of credentialed CORS), so we can never use a wildcard.
// In production, only the configured FRONTEND_URL is allowed. In dev, Next.js
// often picks a different port than 3000 if it's already in use (3001, 3002,
// ...), so instead of hardcoding one port we allow any localhost/127.0.0.1
// origin - still safe, since it can never match a real attacker's origin.
const isProd = process.env.NODE_ENV === "production";
const configuredOrigin = process.env.FRONTEND_URL;

app.use(cors({
  origin: isProd
    ? configuredOrigin
    : (origin, callback) => {
        if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api", router);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
