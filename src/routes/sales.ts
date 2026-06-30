import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

function genOrderNumber(): string {
  return `SO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function formatOrder(order: any) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName: order.customer?.name ?? null,
    status: order.status,
    subtotal: Number(order.subtotal),
    tax: Number(order.tax),
    discount: Number(order.discount),
    total: Number(order.total),
    notes: order.notes,
    items: (order.items ?? []).map((i: any) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product?.name ?? "",
      productSku: i.product?.sku ?? "",
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      discount: Number(i.discount),
      total: Number(i.total),
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

// GET /api/sales/summary/stats
router.get("/summary/stats", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [total, pending, completed, cancelled] = await Promise.all([
      prisma.salesOrder.aggregate({ _count: true, _sum: { total: true } }),
      prisma.salesOrder.count({ where: { status: "pending" } }),
      prisma.salesOrder.count({ where: { status: "completed" } }),
      prisma.salesOrder.count({ where: { status: "cancelled" } }),
    ]);

    const totalOrders = total._count;
    const totalRevenue = Number(total._sum.total ?? 0);

    res.json({
      totalRevenue,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      pendingOrders: pending,
      completedOrders: completed,
      cancelledOrders: cancelled,
    });
  } catch (err) {
    console.error("Sales summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/sales
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, customerId } = req.query as Record<string, string>;

    const orders = await prisma.salesOrder.findMany({
      where: {
        ...(status && { status }),
        ...(customerId && { customerId: parseInt(customerId) }),
      },
      include: {
        customer: { select: { name: true } },
        items: {
          include: { product: { select: { name: true, sku: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(orders.map(formatOrder));
  } catch (err) {
    console.error("List sales orders error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/sales
router.post("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { customerId, items, discount, tax, notes } = req.body;
    if (!customerId || !items?.length) {
      res.status(400).json({ error: "Customer and items are required" });
      return;
    }

    let subtotal = 0;
    for (const item of items) {
      subtotal += item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100);
    }
    const taxAmount = ((tax || 0) / 100) * subtotal;
    const discountAmount = discount || 0;
    const total = subtotal + taxAmount - discountAmount;

    const order = await prisma.salesOrder.create({
      data: {
        orderNumber: genOrderNumber(),
        customerId,
        status: "pending",
        subtotal,
        tax: taxAmount,
        discount: discountAmount,
        total,
        notes,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            total: item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100),
          })),
        },
      },
      include: {
        customer: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    res.status(201).json(formatOrder(order));
  } catch (err) {
    console.error("Create sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/sales/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatOrder(order));
  } catch (err) {
    console.error("Get sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/sales/:id
router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { status, notes } = req.body;

    const order = await prisma.salesOrder.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        customer: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    res.json(formatOrder(order));
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/sales/:id
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction([
      prisma.salesOrderItem.deleteMany({ where: { orderId: id } }),
      prisma.salesOrder.delete({ where: { id } }),
    ]);
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Delete sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
