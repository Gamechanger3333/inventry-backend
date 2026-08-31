import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, verifyCsrf, AuthRequest } from "../middleware/auth";

const router = Router();

function genOrderNumber(): string {
  return `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function formatOrder(order: any) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    supplierId: order.supplierId,
    supplierName: order.supplier?.name ?? null,
    warehouseId: order.warehouseId,
    warehouseName: order.warehouse?.name ?? null,
    status: order.status,
    total: Number(order.total),
    notes: order.notes,
    expectedDate: order.expectedDate?.toISOString() ?? null,
    items: (order.items ?? []).map((i: any) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product?.name ?? "",
      productSku: i.product?.sku ?? "",
      quantity: i.quantity,
      unitCost: Number(i.unitCost),
      total: Number(i.total),
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

// GET /api/purchases
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, supplierId } = req.query as Record<string, string>;

    const orders = await prisma.purchaseOrder.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(status && { status }),
        ...(supplierId && { supplierId: parseInt(supplierId) }),
      },
      include: {
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(orders.map(formatOrder));
  } catch (err) {
    console.error("List purchases error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/purchases
router.post("/", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { supplierId, warehouseId, items, notes, expectedDate } = req.body;
    if (!supplierId || !items?.length) {
      res.status(400).json({ error: "Supplier and items are required" });
      return;
    }

    const organizationId = req.user!.organizationId;

    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!supplier) {
      res.status(400).json({ error: "Invalid supplier" });
      return;
    }
    if (warehouseId) {
      const wh = await prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
      if (!wh) {
        res.status(400).json({ error: "Invalid warehouse" });
        return;
      }
    }
    const productIds = [...new Set(items.map((i: any) => i.productId))];
    const ownedProductCount = await prisma.product.count({ where: { id: { in: productIds as number[] }, organizationId } });
    if (ownedProductCount !== productIds.length) {
      res.status(400).json({ error: "One or more items reference an invalid product" });
      return;
    }

    const total = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitCost, 0);

    const order = await prisma.purchaseOrder.create({
      data: {
        organizationId,
        orderNumber: genOrderNumber(),
        supplierId,
        warehouseId: warehouseId || null,
        status: "draft",
        total,
        notes,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            total: item.quantity * item.unitCost,
          })),
        },
      },
      include: {
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    res.status(201).json(formatOrder(order));
  } catch (err) {
    console.error("Create purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/purchases/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const order = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: {
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatOrder(order));
  } catch (err) {
    console.error("Get purchase error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/purchases/:id — also handles receiving (status → received)
router.patch("/:id", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { status, notes, expectedDate } = req.body;
    const organizationId = req.user!.organizationId;

    const existing = await prisma.purchaseOrder.findFirst({ where: { id, organizationId } });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Guard against double-processing: if this order was already marked
    // "received" once, don't add the stock again on a subsequent save
    // (e.g. someone re-saving the same order, or a duplicate request).
    const alreadyReceived = existing.status === "received";
    const isBeingReceived = status === "received" && !alreadyReceived;

    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(status !== undefined && { status }),
          ...(notes !== undefined && { notes }),
          ...(expectedDate !== undefined && { expectedDate: new Date(expectedDate) }),
        },
        include: {
          supplier: { select: { name: true } },
          warehouse: { select: { name: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
        },
      });

      if (isBeingReceived && updated.warehouseId) {
        for (const item of updated.items) {
          await tx.inventory.upsert({
            where: {
              productId_warehouseId: {
                productId: item.productId,
                warehouseId: updated.warehouseId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              organizationId,
              productId: item.productId,
              warehouseId: updated.warehouseId,
              quantity: item.quantity,
            },
          });

          await tx.inventoryTransaction.create({
            data: {
              organizationId,
              productId: item.productId,
              warehouseId: updated.warehouseId,
              type: "purchase_receipt",
              quantity: item.quantity,
              reason: `Purchase order ${updated.orderNumber} received`,
              performedBy: req.user?.id ?? null,
            },
          });
        }
      }

      return updated;
    });

    res.json(formatOrder(order));
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/purchases/:id
router.delete("/:id", requireAuth, verifyCsrf, requireRole("Purchasing Manager"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = req.user!.organizationId;

    const existing = await prisma.purchaseOrder.findFirst({ where: { id, organizationId }, select: { id: true, status: true } });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Same reasoning as sales: deleting a received PO would silently drop
    // the fact that stock was ever added for it.
    if (existing.status === "received") {
      res.status(400).json({ error: "A received purchase order cannot be deleted, as its stock has already been added to inventory" });
      return;
    }

    await prisma.$transaction([
      prisma.purchaseOrderItem.deleteMany({ where: { orderId: id } }),
      prisma.purchaseOrder.deleteMany({ where: { id, organizationId } }),
    ]);
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Delete purchase order error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
