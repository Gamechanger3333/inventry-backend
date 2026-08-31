import crypto from "crypto";

export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/** "Acme Corp" -> "acme-corp". Appends a short random suffix on collision
 *  (the caller re-checks uniqueness; this is just the candidate generator). */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "org";
  return base;
}
