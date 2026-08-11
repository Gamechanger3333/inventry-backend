import rateLimit from "express-rate-limit";

// General API traffic — generous, mainly to blunt scraping/DoS.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// Auth endpoints (login, register, forgot-password, reset-password, verify).
// Tight enough to make brute-forcing a password impractical, loose enough
// that a real user mistyping their password a few times isn't locked out.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failed attempts against the limit
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});

// Public, unauthenticated AI chat — no user account backing it, so this is
// the main abuse surface for running up LLM API costs. Kept tight.
export const publicAiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're sending messages too quickly. Please slow down." },
});
