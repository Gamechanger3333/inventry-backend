import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, verifyCsrf, AuthRequest } from "../middleware/auth";
import { raiseLowStockAlerts } from "../lib/notify";

const router = Router();

class InsufficientStockError extends Error {
  constructor() {
    super("Insufficient stock in source warehouse");
    this.name = "InsufficientStockError";
  }
}

// GET /api/inventory
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { warehouseId, productId } = req.query as Record<string, string>;
    const organizationId = req.user!.organizationId;

    const inventory = await prisma.inventory.findMany({
      where: {
        organizationId,
        ...(warehouseId && { warehouseId: parseInt(warehouseId) }),
        ...(productId && { productId: parseInt(productId) }),
      },
      include: {
        product: { select: { name: true, sku: true, reorderPoint: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { product: { name: "asc" } },
    });

    res.json(
      inventory.map((inv) => ({
        id: inv.id,
        productId: inv.productId,
        warehouseId: inv.warehouseId,
        quantity: inv.quantity,
        productName: inv.product.name,
        productSku: inv.product.sku,
        reorderPoint: inv.product.reorderPoint,
        warehouseName: inv.warehouse.name,
        updatedAt: inv.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("List inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/inventory/adjust
router.post("/adjust", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, warehouseId, quantity, reason } = req.body;
    if (!productId || !warehouseId || quantity === undefined || !reason) {
      res.status(400).json({ error: "productId, warehouseId, quantity and reason are required" });
      return;
    }

    const organizationId = req.user!.organizationId;

    // The product and warehouse must both belong to this org, or a user
    // could adjust stock for another tenant's product by guessing its id.
    const [product, warehouse] = await Promise.all([
      prisma.product.findFirst({ where: { id: productId, organizationId } }),
      prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId } }),
    ]);
    if (!product || !warehouse) {
      res.status(404).json({ error: "Product or warehouse not found" });
      return;
    }

    // Everything below must happen atomically: two concurrent adjustments on
    // the same product/warehouse must not read the same "before" quantity
    // and clobber each other. We do the read-check-write inside a single
    // transaction so Postgres serializes conflicting writes for us.
    const inv = await prisma.$transaction(async (tx) => {
      const existing = await tx.inventory.findUnique({
        where: { productId_warehouseId: { productId, warehouseId } },
      });

      const newQty = Math.max(0, (existing?.quantity ?? 0) + quantity);

      const updated = await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        update: { quantity: newQty },
        create: { organizationId, productId, warehouseId, quantity: Math.max(0, quantity) },
        include: {
          product: { select: { name: true, sku: true, reorderPoint: true } },
          warehouse: { select: { name: true } },
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          organizationId,
          productId,
          warehouseId,
          type: "adjustment",
          quantity,
          reason,
          performedBy: req.user?.id ?? null,
        },
      });

      return updated;
    });

    await raiseLowStockAlerts(organizationId, [
      { productId: inv.productId, warehouseId: inv.warehouseId, quantity: inv.quantity, product: inv.product, warehouse: inv.warehouse },
    ]);

    res.json({
      id: inv.id,
      productId: inv.productId,
      warehouseId: inv.warehouseId,
      quantity: inv.quantity,
      productName: inv.product.name,
      productSku: inv.product.sku,
      reorderPoint: inv.product.reorderPoint,
      warehouseName: inv.warehouse.name,
      updatedAt: inv.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("Adjust inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/inventory/transfer
router.post("/transfer", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, fromWarehouseId, toWarehouseId, quantity, notes } = req.body;
    if (!productId || !fromWarehouseId || !toWarehouseId || !quantity) {
      res.status(400).json({ error: "productId, fromWarehouseId, toWarehouseId and quantity are required" });
      return;
    }
    if (quantity <= 0) {
      res.status(400).json({ error: "Quantity must be greater than zero" });
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      res.status(400).json({ error: "Source and destination warehouse must be different" });
      return;
    }

    const organizationId = req.user!.organizationId;

    const [product, fromWh, toWh] = await Promise.all([
      prisma.product.findFirst({ where: { id: productId, organizationId } }),
      prisma.warehouse.findFirst({ where: { id: fromWarehouseId, organizationId } }),
      prisma.warehouse.findFirst({ where: { id: toWarehouseId, organizationId } }),
    ]);
    if (!product || !fromWh || !toWh) {
      res.status(404).json({ error: "Product or warehouse not found" });
      return;
    }

    const sourceAfter = await prisma.$transaction(async (tx) => {
      // Re-read the source row *inside* the transaction and guard the
      // decrement with a conditional update, so two concurrent transfers
      // can't both pass the "enough stock" check against the same stale
      // read and drive the quantity negative.
      const fromInv = await tx.inventory.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
      });

      if (!fromInv || fromInv.quantity < quantity) {
        throw new InsufficientStockError();
      }

      const decremented = await tx.inventory.updateMany({
        where: {
          productId,
          warehouseId: fromWarehouseId,
          quantity: { gte: quantity },
        },
        data: { quantity: { decrement: quantity } },
      });

      if (decremented.count === 0) {
        // Someone else consumed the stock between our read and our write.
        throw new InsufficientStockError();
      }

      // Increase at destination
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
        update: { quantity: { increment: quantity } },
        create: { organizationId, productId, warehouseId: toWarehouseId, quantity },
      });

      // Transaction logs
      await tx.inventoryTransaction.create({
        data: {
          organizationId,
          productId,
          warehouseId: fromWarehouseId,
          type: "transfer_out",
          quantity: -quantity,
          reason: `Transfer to warehouse ${toWarehouseId}`,
          notes,
          performedBy: req.user?.id ?? null,
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          organizationId,
          productId,
          warehouseId: toWarehouseId,
          type: "transfer_in",
          quantity,
          reason: `Transfer from warehouse ${fromWarehouseId}`,
          notes,
          performedBy: req.user?.id ?? null,
        },
      });

      return fromInv.quantity - quantity;
    });

    // The source warehouse may now be at/below reorder point even though
    // nothing was "sold" - a transfer can trigger the same alert a sale can.
    await raiseLowStockAlerts(organizationId, [
      {
        productId,
        warehouseId: fromWarehouseId,
        quantity: sourceAfter,
        product: { name: product.name, sku: product.sku, reorderPoint: product.reorderPoint },
        warehouse: { name: fromWh.name },
      },
    ]);

    res.json({ message: "Transfer completed successfully" });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      res.status(400).json({ error: "Insufficient stock in source warehouse" });
      return;
    }
    console.error("Transfer inventory error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/inventory/transactions
router.get("/transactions", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, warehouseId, limit } = req.query as Record<string, string>;

    const transactions = await prisma.inventoryTransaction.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(productId && { productId: parseInt(productId) }),
        ...(warehouseId && { warehouseId: parseInt(warehouseId) }),
      },
      include: {
        product: { select: { name: true } },
        warehouse: { select: { name: true } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit ? parseInt(limit) : 100,
    });

    res.json(
      transactions.map((t) => ({
        id: t.id,
        productId: t.productId,
        warehouseId: t.warehouseId,
        type: t.type,
        quantity: t.quantity,
        reason: t.reason,
        notes: t.notes,
        productName: t.product.name,
        warehouseName: t.warehouse.name,
        performedBy: t.user?.name ?? null,
        createdAt: t.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("List transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
