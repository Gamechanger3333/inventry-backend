import { z, ZodSchema } from "zod";
import { Request, Response, NextFunction } from "express";

// Must match the role list offered on the frontend signup form —
// keeping it a closed enum (not a free string) stops garbage/privilege
// values ("SuperAdmin", "root", etc.) from ever reaching the database.
export const ROLES = [
  "Sales Representative",
  "Inventory Manager",
  "Purchasing Manager",
  "Warehouse Manager",
  "Finance Manager",
  "Administrator",
] as const;

// 8+ chars, at least one letter and one number — enough to rule out
// "12345678" / "password" while not being obnoxious about symbols.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: passwordSchema,
  role: z.enum(ROLES).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: passwordSchema,
});

export const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const resendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
});

/**
 * Validates req.body against a zod schema, replaces req.body with the
 * parsed (and coerced/trimmed) result, and responds 400 with a clear
 * field-level error message on failure — otherwise calls next().
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      res.status(400).json({ error: first?.message ?? "Invalid request", field: first?.path?.[0] });
      return;
    }
    req.body = result.data;
    next();
  };
}
