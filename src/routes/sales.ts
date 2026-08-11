import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { getPagination, sendPaginated } from "../lib/pagination";

const router = Router();

// Real type for the transaction client instead of `any` — this is what
// gives every tx.* call inside these two functions full type-checking and
// autocomplete (and is what was silently defeating strict-mode checks below).
type TxClient = Prisma.TransactionClient;

class InsufficientStockError extends Error {
  constructor(productName: string) {
    super(`Insufficient stock for ${productName}`);
    this.name = "InsufficientStockError";
  }
}

// This schema doesn't tie a SalesOrder to a specific warehouse, so
// "completing" a sale draws stock from whichever warehouse(s) have it,
// cheapest-first by warehouse id, until the line quantity is covered.
// Each individual deduction is recorded as its own InventoryTransaction so
// that a later cancellation can reverse exactly what was taken from where.
async function deductStockForOrder(
  tx: TxClient,
  orderId: number,
  orderNumber: string,
  items: { productId: number; quantity: number }[],
  performedBy: number | null | undefined
) {
  for (const item of items) {
    const inventoryRows = await tx.inventory.findMany({
      where: { productId: item.productId, quantity: { gt: 0 } },
      orderBy: { warehouseId: "asc" },
    });

    const totalAvailable = inventoryRows.reduce((sum, row) => sum + row.quantity, 0);
    if (totalAvailable < item.quantity) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      throw new InsufficientStockError(product?.name ?? `product #${item.productId}`);
    }

    let remaining = item.quantity;
    for (const row of inventoryRows) {
      if (remaining <= 0) break;
      const take = Math.min(row.quantity, remaining);

      const decremented = await tx.inventory.updateMany({
        where: { productId: row.productId, warehouseId: row.warehouseId, quantity: { gte: take } },
        data: { quantity: { decrement: take } },
      });
      if (decremented.count === 0) {
        // Stock moved under us - bail out and let the caller retry.
        throw new InsufficientStockError(`product #${item.productId} (concurrent update)`);
      }

      await tx.inventoryTransaction.create({
        data: {
          productId: row.productId,
          warehouseId: row.warehouseId,
          type: "sale",
          quantity: -take,
          reason: `Sales order ${orderNumber} completed`,
          notes: `orderId:${orderId}`,
          performedBy: performedBy ?? null,
        },
      });

      remaining -= take;
    }
  }
}

// Reverses exactly the deductions recorded by deductStockForOrder for this
// order (looked up via the InventoryTransaction log), used when a completed
// order is later cancelled.
async function restockOrder(
  tx: TxClient,
  orderId: number,
  orderNumber: string,
  performedBy: number | null | undefined
) {
  const saleTxns = await tx.inventoryTransaction.findMany({
    where: { type: "sale", notes: `orderId:${orderId}` },
  });

  for (const t of saleTxns) {
    const restoreQty = Math.abs(t.quantity);
    await tx.inventory.upsert({
      where: { productId_warehouseId: { productId: t.productId, warehouseId: t.warehouseId } },
      update: { quantity: { increment: restoreQty } },
      create: { productId: t.productId, warehouseId: t.warehouseId, quantity: restoreQty },
    });

    await tx.inventoryTransaction.create({
      data: {
        productId: t.productId,
        warehouseId: t.warehouseId,
        type: "sale_reversal",
        quantity: restoreQty,
        reason: `Sales order ${orderNumber} cancelled - stock restored`,
        notes: `orderId:${orderId}`,
        performedBy: performedBy ?? null,
      },
    });
  }
}

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
    const pagination = getPagination(req);

    const where = {
      ...(status && { status }),
      ...(customerId && { customerId: parseInt(customerId) }),
    };

    const [orders, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          items: {
            include: { product: { select: { name: true, sku: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.salesOrder.count({ where }),
    ]);

    sendPaginated(res, orders.map(formatOrder), total, pagination);
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

    const existing = await prisma.salesOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const wasCompleted = existing.status === "completed";
    const willBeCompleted = status === "completed";

    const order = await prisma.$transaction(async (tx) => {
      // Deduct stock the moment an order first becomes "completed".
      if (willBeCompleted && !wasCompleted) {
        await deductStockForOrder(
          tx,
          existing.id,
          existing.orderNumber,
          existing.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          req.user?.id
        );
      }

      // Put stock back if a completed order is moved to any other status
      // (e.g. cancelled / refunded).
      if (wasCompleted && status !== undefined && !willBeCompleted) {
        await restockOrder(tx, existing.id, existing.orderNumber, req.user?.id);
      }

      return tx.salesOrder.update({
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
    });

    res.json(formatOrder(order));
  } catch (err: any) {
    if (err instanceof InsufficientStockError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update sales order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/sales/:id
router.delete("/:id", requireAuth, requireRole("Sales Representative"), async (req: AuthRequest, res: Response): Promise<void> => {
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
