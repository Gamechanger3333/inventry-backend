import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, verifyCsrf, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/suppliers
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search } = req.query as Record<string, string>;
    const organizationId = req.user!.organizationId;

    const suppliers = await prisma.supplier.findMany({
      where: {
        organizationId,
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }),
      },
      include: { _count: { select: { purchaseOrders: true } } },
      orderBy: { name: "asc" },
    });

    res.json(
      suppliers.map((s) => ({
        ...s,
        orderCount: s._count.purchaseOrders,
        createdAt: s.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("List suppliers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/suppliers
router.post("/", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, phone, address, contactPerson, notes } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const supplier = await prisma.supplier.create({
      data: { organizationId: req.user!.organizationId, name, email, phone, address, contactPerson, notes },
    });
    res.status(201).json({ ...supplier, orderCount: 0, createdAt: supplier.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(400).json({ error: "A supplier with this email already exists" });
      return;
    }
    console.error("Create supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/suppliers/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const supplier = await prisma.supplier.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: { _count: { select: { purchaseOrders: true } } },
    });
    if (!supplier) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...supplier, orderCount: supplier._count.purchaseOrders, createdAt: supplier.createdAt.toISOString() });
  } catch (err) {
    console.error("Get supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/suppliers/:id
router.patch("/:id", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { name, email, phone, address, contactPerson, notes } = req.body;
    const owned = await prisma.supplier.findFirst({ where: { id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(contactPerson !== undefined && { contactPerson }),
        ...(notes !== undefined && { notes }),
      },
      include: { _count: { select: { purchaseOrders: true } } },
    });
    res.json({ ...supplier, orderCount: supplier._count.purchaseOrders, createdAt: supplier.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(400).json({ error: "A supplier with this email already exists" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/suppliers/:id
router.delete("/:id", requireAuth, verifyCsrf, requireRole("Purchasing Manager"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const result = await prisma.supplier.deleteMany({ where: { id, organizationId: req.user!.organizationId } });
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
    console.error("Delete supplier error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
