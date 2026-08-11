import { describe, it, expect, vi } from "vitest";
import { requireRole, AuthRequest } from "../middleware/auth";
import { Response } from "express";

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function mockReq(role?: string): AuthRequest {
  return {
    user: role
      ? {
          id: 1,
          name: "Test User",
          email: "test@example.com",
          role,
          avatar: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          emailVerified: true,
        }
      : undefined,
  } as AuthRequest;
}

describe("requireRole middleware", () => {
  it("allows a user whose role is in the allowed list", () => {
    const req = mockReq("Sales Representative");
    const res = mockRes();
    const next = vi.fn();

    requireRole("Sales Representative", "Finance Manager")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks a user whose role is NOT in the allowed list", () => {
    const req = mockReq("Warehouse Manager");
    const res = mockRes();
    const next = vi.fn();

    requireRole("Sales Representative", "Finance Manager")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("always allows Administrator regardless of the allowed list (superset role)", () => {
    const req = mockReq("Administrator");
    const res = mockRes();
    const next = vi.fn();

    requireRole("Warehouse Manager")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects with 401 when there is no authenticated user at all", () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    requireRole("Administrator")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
