import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { signToken, requireAuth, AuthRequest } from "../middleware/auth";
import { sendVerificationEmail, sendOtpEmail, sendPasswordResetEmail } from "../lib/email";
import { generateOtp, generateToken, minutesFromNow } from "../lib/tokens";

const router = Router();

function publicUser(user: {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  createdAt: Date;
  emailVerified: boolean;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ error: "Name, email and password are required" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const verifyToken = generateToken();

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: role || "Sales Representative",
        emailVerified: false,
        otpCode: otp,
        otpExpiresAt: minutesFromNow(15),
        verifyToken,
        verifyTokenExpiresAt: minutesFromNow(15),
      },
    });

    let emailSent = false;
    try {
      emailSent = await sendVerificationEmail(user.email, user.name, otp, verifyToken);
    } catch (emailErr) {
      console.error("Failed to send verification email:", emailErr);
      // Don't fail registration just because the email didn't send —
      // the user can use "resend code" afterwards.
    }

    res.status(201).json({
      message: emailSent
        ? "Account created. Please check your email for a verification code."
        : "Account created. No email provider is configured, so here is your verification code directly.",
      email: user.email,
      // DEV-ONLY FALLBACK: if no email provider is configured (no
      // RESEND_API_KEY), there is no other way for the user to receive
      // this code. Never sent once a real provider is wired up, and never
      // sent in production even if email happens to be misconfigured there.
      ...(process.env.NODE_ENV !== "production" && !emailSent ? { devOtp: otp } : {}),
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/verify-otp
router.post("/verify-otp", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      res.status(400).json({ error: "Email and code are required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: "No account found for this email" });
      return;
    }
    if (user.emailVerified) {
      res.status(400).json({ error: "Email is already verified" });
      return;
    }
    if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      res.status(400).json({ error: "Code expired. Please request a new one." });
      return;
    }
    if (user.otpCode !== otp) {
      res.status(400).json({ error: "Invalid code" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        verifyToken: null,
        verifyTokenExpiresAt: null,
      },
    });

    const token = signToken(updated.id);
    res.json({ token, user: publicUser(updated) });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/verify-email?token=...
router.get("/verify-email", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Invalid verification link" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { verifyToken: token } });
    if (!user || !user.verifyTokenExpiresAt || user.verifyTokenExpiresAt < new Date()) {
      res.status(400).json({ error: "This verification link is invalid or has expired" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        verifyToken: null,
        verifyTokenExpiresAt: null,
      },
    });

    const authToken = signToken(updated.id);
    res.json({ token: authToken, user: publicUser(updated) });
  } catch (err) {
    console.error("Verify email error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/resend-otp
router.post("/resend-otp", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Don't leak whether the account exists.
    if (!user || user.emailVerified) {
      res.json({ message: "If an account exists, a new code has been sent." });
      return;
    }

    const otp = generateOtp();
    const verifyToken = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiresAt: minutesFromNow(15),
        verifyToken,
        verifyTokenExpiresAt: minutesFromNow(15),
      },
    });

    let emailSent = false;
    try {
      emailSent = await sendOtpEmail(user.email, user.name, otp);
    } catch (emailErr) {
      // Previously uncaught here - a failed send would 500 the whole
      // request and leave the user with no way to get a new code at all.
      console.error("Failed to send OTP email:", emailErr);
    }

    res.json({
      message: "If an account exists, a new code has been sent.",
      ...(process.env.NODE_ENV !== "production" && !emailSent ? { devOtp: otp } : {}),
    });
  } catch (err) {
    console.error("Resend OTP error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({
        error: "Please verify your email before signing in.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
      return;
    }

    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Always respond the same way to avoid leaking which emails are registered.
    if (!user) {
      res.json({ message: "If an account exists for this email, a reset link has been sent." });
      return;
    }

    const resetToken = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetTokenExpiresAt: minutesFromNow(30),
      },
    });

    let emailSent = false;
    try {
      emailSent = await sendPasswordResetEmail(user.email, user.name, resetToken);
    } catch (emailErr) {
      console.error("Failed to send password reset email:", emailErr);
    }

    res.json({
      message: "If an account exists for this email, a reset link has been sent.",
      // DEV-ONLY FALLBACK: no email provider configured means there's no
      // other way to get this token. Never sent in production.
      ...(process.env.NODE_ENV !== "production" && !emailSent
        ? { devResetToken: resetToken }
        : {}),
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: "Token and new password are required" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      res.status(400).json({ error: "This reset link is invalid or has expired" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });

    res.json({ message: "Password reset successfully. You can now sign in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, (req: AuthRequest, res: Response): void => {
  res.json(publicUser(req.user!));
});

// POST /api/auth/logout
router.post("/logout", (_req: Request, res: Response): void => {
  res.json({ message: "Logged out" });
});

export default router;
