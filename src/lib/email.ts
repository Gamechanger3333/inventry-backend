import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM || "Nexus <onboarding@resend.dev>";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function wrapper(title: string, bodyHtml: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background:#f8fafc;">
    <div style="background:#ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <div style="text-align:center; margin-bottom: 24px;">
        <div style="display:inline-flex; align-items:center; justify-content:center; width:48px; height:48px; background:#0f172a; border-radius:12px; margin-bottom:12px;">
          <span style="color:#fff; font-size:22px; font-weight:700;">N</span>
        </div>
        <h1 style="font-size:18px; color:#0f172a; margin:0;">Nexus</h1>
      </div>
      <h2 style="font-size:20px; color:#0f172a; margin: 0 0 12px;">${title}</h2>
      ${bodyHtml}
      <p style="color:#94a3b8; font-size:12px; margin-top:32px; text-align:center;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  </div>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping send to ${to}`);
    return false;
  }
  console.log(`[email] Sending "${subject}" to ${to}`);
  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
  console.log(`[email] Result:`, { data, error });
  if (error) {
    console.error("[email] Resend error:", error);
    throw new Error("Failed to send email");
  }
  return true;
}

export async function sendVerificationEmail(to: string, name: string, otp: string, token: string): Promise<boolean> {
  const link = `${FRONTEND_URL}/verify-email?token=${token}`;
  const html = wrapper(
    `Verify your email, ${name.split(" ")[0]}`,
    `
    <p style="color:#475569; font-size:14px; line-height:1.6;">
      Thanks for signing up for Nexus. Use the code below to verify your email,
      or click the button to verify instantly.
    </p>
    <div style="text-align:center; margin: 24px 0;">
      <div style="display:inline-block; background:#f1f5f9; border-radius:8px; padding:16px 32px; font-size:32px; font-weight:700; letter-spacing:8px; color:#0f172a;">
        ${otp}
      </div>
    </div>
    <p style="color:#94a3b8; font-size:13px; text-align:center; margin:0 0 20px;">This code expires in 15 minutes.</p>
    <div style="text-align:center;">
      <a href="${link}" style="display:inline-block; background:#0f172a; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-size:14px; font-weight:600;">
        Verify Email
      </a>
    </div>
    `
  );
  return sendEmail(to, "Verify your Nexus account", html);
}

export async function sendOtpEmail(to: string, name: string, otp: string): Promise<boolean> {
  const html = wrapper(
    `Your verification code`,
    `
    <p style="color:#475569; font-size:14px; line-height:1.6;">
      Hi ${name.split(" ")[0]}, here's your new verification code:
    </p>
    <div style="text-align:center; margin: 24px 0;">
      <div style="display:inline-block; background:#f1f5f9; border-radius:8px; padding:16px 32px; font-size:32px; font-weight:700; letter-spacing:8px; color:#0f172a;">
        ${otp}
      </div>
    </div>
    <p style="color:#94a3b8; font-size:13px; text-align:center; margin:0;">This code expires in 15 minutes.</p>
    `
  );
  return sendEmail(to, "Your Nexus verification code", html);
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<boolean> {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  const html = wrapper(
    `Reset your password`,
    `
    <p style="color:#475569; font-size:14px; line-height:1.6;">
      Hi ${name.split(" ")[0]}, we received a request to reset your password. Click the button
      below to choose a new one. This link expires in 30 minutes.
    </p>
    <div style="text-align:center; margin: 24px 0;">
      <a href="${link}" style="display:inline-block; background:#0f172a; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-size:14px; font-weight:600;">
        Reset Password
      </a>
    </div>
    <p style="color:#94a3b8; font-size:12px; text-align:center; word-break:break-all;">${link}</p>
    `
  );
  return sendEmail(to, "Reset your Nexus password", html);
}