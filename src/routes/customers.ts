import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, verifyCsrf, AuthRequest } from "../middleware/auth";
import { getPagination, sendPaginated } from "../lib/pagination";

const router = Router();

// GET /api/customers
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search } = req.query as Record<string, string>;
    const pagination = getPagination(req);
    const organizationId = req.user!.organizationId;

    const where = {
      organizationId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: { _count: { select: { salesOrders: true } } },
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.customer.count({ where }),
    ]);

    sendPaginated(
      res,
      customers.map((c) => ({
        ...c,
        orderCount: c._count.salesOrders,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      pagination
    );
  } catch (err) {
    console.error("List customers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/customers
router.post("/", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, phone, address, city, country, notes } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const customer = await prisma.customer.create({
      data: { organizationId: req.user!.organizationId, name, email, phone, address, city, country, notes },
    });
    res.status(201).json({ ...customer, orderCount: 0, createdAt: customer.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(400).json({ error: "A customer with this email already exists" });
      return;
    }
    console.error("Create customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/customers/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const customer = await prisma.customer.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: {
        _count: { select: { salesOrders: true } },
        salesOrders: {
          select: { id: true, orderNumber: true, status: true, total: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
    if (!customer) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...customer,
      orderCount: customer._count.salesOrders,
      salesOrders: customer.salesOrders.map((o) => ({
        ...o,
        total: Number(o.total),
        createdAt: o.createdAt.toISOString(),
      })),
      createdAt: customer.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("Get customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/customers/:id
router.patch("/:id", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { name, email, phone, address, city, country, notes } = req.body;
    const owned = await prisma.customer.findFirst({ where: { id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(country !== undefined && { country }),
        ...(notes !== undefined && { notes }),
      },
      include: { _count: { select: { salesOrders: true } } },
    });
    res.json({ ...customer, orderCount: customer._count.salesOrders, createdAt: customer.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(400).json({ error: "A customer with this email already exists" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/customers/:id
router.delete("/:id", requireAuth, verifyCsrf, requireRole("Sales Representative", "Finance Manager"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const result = await prisma.customer.deleteMany({ where: { id, organizationId: req.user!.organizationId } });
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
    console.error("Delete customer error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
