import { describe, it, expect } from "vitest";
import { registerSchema, loginSchema, resetPasswordSchema } from "../lib/validation";

describe("registerSchema", () => {
  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      name: "Jane Smith",
      email: "Jane@Example.com",
      password: "hunter22",
      role: "Sales Representative",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // email is normalized to lowercase
      expect(result.data.email).toBe("jane@example.com");
    }
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({ name: "Jane", email: "jane@example.com", password: "abc123" });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no digits", () => {
    const result = registerSchema.safeParse({ name: "Jane", email: "jane@example.com", password: "abcdefgh" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({ name: "Jane", email: "not-an-email", password: "abc12345" });
    expect(result.success).toBe(false);
  });

  it("rejects a role outside the allowed enum (privilege injection attempt)", () => {
    const result = registerSchema.safeParse({
      name: "Jane",
      email: "jane@example.com",
      password: "abc12345",
      role: "SuperAdmin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name", () => {
    const result = registerSchema.safeParse({ email: "jane@example.com", password: "abc12345" });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts valid credentials shape", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "anything" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires both a token and a strong-enough password", () => {
    expect(resetPasswordSchema.safeParse({ token: "abc", password: "newpass1" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token: "", password: "newpass1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "abc", password: "short1" }).success).toBe(false);
  });
});
