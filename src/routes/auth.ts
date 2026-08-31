import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { signToken, requireAuth, requireRole, verifyCsrf, AuthRequest, AUTH_COOKIE, CSRF_COOKIE, authCookieOptions } from "../middleware/auth";
import { sendVerificationEmail, sendOtpEmail, sendPasswordResetEmail, sendInviteEmail } from "../lib/email";
import { generateOtp, generateToken, minutesFromNow, slugify } from "../lib/tokens";
import { authLimiter } from "../middleware/rateLimit";
import { validateBody, registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, verifyOtpSchema, resendOtpSchema, createInviteSchema } from "../lib/validation";

const router = Router();

function publicUser(user: {
  id: number;
  organizationId: number;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  createdAt: Date;
  emailVerified: boolean;
}) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Establishes a session: signs the JWT into an httpOnly cookie and issues
 * a fresh CSRF token into a second, JS-readable cookie. Called from every
 * endpoint that used to just return `{ token }` in the response body.
 */
function startSession(res: Response, userId: number): void {
  const token = signToken(userId);
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  const csrfToken = generateToken();
  res.cookie(CSRF_COOKIE, csrfToken, { ...authCookieOptions(), httpOnly: false });
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 1;
  // Small orgs, low collision odds - a short loop is fine, no need for a
  // fancier scheme.
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

// POST /api/auth/register
// Either founds a new company (organizationName -> caller becomes that
// org's Administrator) or joins an existing one via a valid, unexpired,
// not-yet-used invite (inviteToken -> role comes from the invite, never
// from the request body, so a joiner can't grant themselves Administrator).
router.post("/register", authLimiter, validateBody(registerSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, organizationName, inviteToken } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ error: "Email already registered" });
      return;
    }

    let organizationId: number;
    let role: string;
    let invite: { id: number } | null = null;

    if (inviteToken) {
      const found = await prisma.invite.findUnique({ where: { token: inviteToken } });
      if (!found || found.acceptedAt || found.expiresAt < new Date()) {
        res.status(400).json({ error: "This invite link is invalid or has expired" });
        return;
      }
      if (found.email !== email) {
        res.status(400).json({ error: "This invite was issued to a different email address" });
        return;
      }
      organizationId = found.organizationId;
      role = found.role;
      invite = found;
    } else {
      const org = await prisma.organization.create({
        data: { name: organizationName, slug: await uniqueSlug(organizationName) },
      });
      organizationId = org.id;
      role = "Administrator";
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const verifyToken = generateToken();

    const user = await prisma.user.create({
      data: {
        organizationId,
        name,
        email,
        passwordHash,
        role,
        emailVerified: false,
        otpCode: otp,
        otpExpiresAt: minutesFromNow(15),
        verifyToken,
        verifyTokenExpiresAt: minutesFromNow(15),
      },
    });

    if (invite) {
      await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    }

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

// POST /api/auth/invite — Administrator-only, invites a teammate into
// *their own* organization (organizationId always comes from req.user,
// never from the request body).
router.post("/invite", requireAuth, verifyCsrf, requireRole("Administrator"), validateBody(createInviteSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, role } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: "A user with this email already exists" });
      return;
    }

    const token = generateToken();
    const invite = await prisma.invite.create({
      data: {
        organizationId: req.user!.organizationId,
        email,
        role,
        token,
        expiresAt: minutesFromNow(60 * 24 * 7), // 7 days
      },
    });

    let emailSent = false;
    try {
      emailSent = await sendInviteEmail(email, req.user!.name, role, token);
    } catch (emailErr) {
      console.error("Failed to send invite email:", emailErr);
    }

    res.status(201).json({
      message: emailSent ? "Invite sent." : "Invite created. No email provider is configured, so share this link directly.",
      ...(process.env.NODE_ENV !== "production" && !emailSent ? { devInviteToken: invite.token } : {}),
    });
  } catch (err) {
    console.error("Create invite error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/invite/:token — lets the signup page show which org/role
// an invite is for before the user fills in the form.
router.get("/invite/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const invite = await prisma.invite.findUnique({
      where: { token: req.params.token },
      include: { organization: { select: { name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      res.status(404).json({ error: "This invite link is invalid or has expired" });
      return;
    }
    res.json({ email: invite.email, role: invite.role, organizationName: invite.organization.name });
  } catch (err) {
    console.error("Lookup invite error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/verify-otp
router.post("/verify-otp", authLimiter, validateBody(verifyOtpSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;

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

    startSession(res, updated.id);
    res.json({ user: publicUser(updated) });
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

    startSession(res, updated.id);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error("Verify email error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/resend-otp
router.post("/resend-otp", authLimiter, validateBody(resendOtpSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

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
router.post("/login", authLimiter, validateBody(loginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

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

    startSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", authLimiter, validateBody(forgotPasswordSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

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
router.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

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

// GET /api/auth/team — Administrator-only: everyone in the caller's own org.
router.get("/team", requireAuth, requireRole("Administrator"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [members, pendingInvites] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: req.user!.organizationId },
        select: { id: true, name: true, email: true, role: true, avatar: true, emailVerified: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.invite.findMany({
        where: { organizationId: req.user!.organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    res.json({
      members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      pendingInvites: pendingInvites.map((i) => ({
        ...i,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("List team error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, (req: AuthRequest, res: Response): void => {
  res.json(publicUser(req.user!));
});

// POST /api/auth/logout
router.post("/logout", requireAuth, verifyCsrf, (_req: Request, res: Response): void => {
  res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE, { ...authCookieOptions(), httpOnly: false, maxAge: undefined });
  res.json({ message: "Logged out" });
});

export default router;
