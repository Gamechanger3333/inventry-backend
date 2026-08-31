import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, verifyCsrf, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/warehouses
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: "asc" },
    });
    res.json(warehouses.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() })));
  } catch (err) {
    console.error("List warehouses error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/warehouses
router.post("/", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, location } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const w = await prisma.warehouse.create({ data: { name, location, organizationId: req.user!.organizationId } });
    res.status(201).json({ ...w, createdAt: w.createdAt.toISOString() });
  } catch (err) {
    console.error("Create warehouse error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/warehouses/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const w = await prisma.warehouse.findFirst({ where: { id, organizationId: req.user!.organizationId } });
    if (!w) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...w, createdAt: w.createdAt.toISOString() });
  } catch (err) {
    console.error("Get warehouse error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/warehouses/:id
router.patch("/:id", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { name, location, isActive } = req.body;
    const owned = await prisma.warehouse.findFirst({ where: { id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const w = await prisma.warehouse.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(location !== undefined && { location }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json({ ...w, createdAt: w.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update warehouse error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/warehouses/:id
router.delete("/:id", requireAuth, verifyCsrf, requireRole("Warehouse Manager"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const result = await prisma.warehouse.deleteMany({ where: { id, organizationId: req.user!.organizationId } });
    if (result.count === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Delete warehouse error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
