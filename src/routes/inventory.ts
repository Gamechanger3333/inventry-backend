import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/inventory
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { warehouseId, productId } = req.query as Record<string, string>;

    const inventory = await prisma.inventory.findMany({
      where: {
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
router.post("/adjust", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, warehouseId, quantity, reason } = req.body;
    if (!productId || !warehouseId || quantity === undefined || !reason) {
      res.status(400).json({ error: "productId, warehouseId, quantity and reason are required" });
      return;
    }

    const existing = await prisma.inventory.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    });

    const newQty = Math.max(0, (existing?.quantity ?? 0) + quantity);

    const inv = await prisma.inventory.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      update: { quantity: newQty },
      create: { productId, warehouseId, quantity: Math.max(0, quantity) },
      include: {
        product: { select: { name: true, sku: true, reorderPoint: true } },
        warehouse: { select: { name: true } },
      },
    });

    await prisma.inventoryTransaction.create({
      data: {
        productId,
        warehouseId,
        type: "adjustment",
        quantity,
        reason,
        performedBy: req.user?.id ?? null,
      },
    });

    // Auto-create low-stock notification
    if (inv.quantity <= inv.product.reorderPoint) {
      await prisma.notification.create({
        data: {
          type: "low_stock",
          title: "Low Stock Alert",
          message: `${inv.product.name} (${inv.product.sku}) is below reorder point in ${inv.warehouse.name}. Current: ${inv.quantity}, Reorder at: ${inv.product.reorderPoint}`,
          data: { productId, warehouseId, quantity: inv.quantity },
        },
      });
    }

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
router.post("/transfer", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, fromWarehouseId, toWarehouseId, quantity, notes } = req.body;
    if (!productId || !fromWarehouseId || !toWarehouseId || !quantity) {
      res.status(400).json({ error: "productId, fromWarehouseId, toWarehouseId and quantity are required" });
      return;
    }

    const fromInv = await prisma.inventory.findUnique({
      where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
    });

    if (!fromInv || fromInv.quantity < quantity) {
      res.status(400).json({ error: "Insufficient stock in source warehouse" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Decrease from source
      await tx.inventory.update({
        where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
        data: { quantity: fromInv.quantity - quantity },
      });

      // Increase at destination
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
        update: { quantity: { increment: quantity } },
        create: { productId, warehouseId: toWarehouseId, quantity },
      });

      // Transaction logs
      await tx.inventoryTransaction.create({
        data: {
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
          productId,
          warehouseId: toWarehouseId,
          type: "transfer_in",
          quantity,
          reason: `Transfer from warehouse ${fromWarehouseId}`,
          notes,
          performedBy: req.user?.id ?? null,
        },
      });
    });

    res.json({ message: "Transfer completed successfully" });
  } catch (err) {
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
