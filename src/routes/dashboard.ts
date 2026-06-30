import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/dashboard/summary
router.get("/summary", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      prodCount,
      custCount,
      orderCount,
      totalRevRow,
      thisMonthRev,
      lastMonthRev,
      thisMonthOrders,
      lastMonthOrders,
      pendingOrders,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.customer.count(),
      prisma.salesOrder.count(),
      prisma.salesOrder.aggregate({ _sum: { total: true }, where: { status: "completed" } }),
      prisma.salesOrder.aggregate({
        _sum: { total: true },
        where: { status: "completed", createdAt: { gte: thisMonthStart } },
      }),
      prisma.salesOrder.aggregate({
        _sum: { total: true },
        where: {
          status: "completed",
          createdAt: { gte: lastMonthStart, lt: thisMonthStart },
        },
      }),
      prisma.salesOrder.count({ where: { createdAt: { gte: thisMonthStart } } }),
      prisma.salesOrder.count({
        where: { createdAt: { gte: lastMonthStart, lt: thisMonthStart } },
      }),
      prisma.salesOrder.count({ where: { status: "pending" } }),
    ]);

    // Low stock count
    const inventory = await prisma.inventory.findMany({
      include: { product: { select: { reorderPoint: true } } },
    });
    const lowStockCount = inventory.filter((inv) => inv.quantity <= inv.product.reorderPoint).length;

    const thisRev = Number(thisMonthRev._sum.total ?? 0);
    const lastRev = Number(lastMonthRev._sum.total ?? 0);
    const revenueGrowth = lastRev > 0 ? ((thisRev - lastRev) / lastRev) * 100 : 0;
    const ordersGrowth =
      lastMonthOrders > 0
        ? ((thisMonthOrders - lastMonthOrders) / lastMonthOrders) * 100
        : 0;

    res.json({
      totalRevenue: Number(totalRevRow._sum.total ?? 0),
      totalOrders: orderCount,
      totalProducts: prodCount,
      totalCustomers: custCount,
      revenueGrowth: Math.round(revenueGrowth * 10) / 10,
      ordersGrowth: Math.round(ordersGrowth * 10) / 10,
      lowStockCount,
      pendingOrders,
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/revenue-chart
router.get("/revenue-chart", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const months = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("en", { month: "short", year: "2-digit" });
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

      const agg = await prisma.salesOrder.aggregate({
        _sum: { total: true },
        where: { status: "completed", createdAt: { gte: start, lt: end } },
      });

      months.push({ label, value: Number(agg._sum.total ?? 0) });
    }

    res.json(months);
  } catch (err) {
    console.error("Revenue chart error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/top-products
router.get("/top-products", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const topProducts = await prisma.salesOrderItem.groupBy({
      by: ["productId"],
      _sum: { total: true, quantity: true },
      orderBy: { _sum: { total: "desc" } },
      take: 10,
    });

    const result = await Promise.all(
      topProducts.map(async (row) => {
        const product = await prisma.product.findUnique({
          where: { id: row.productId },
          include: { inventory: { select: { quantity: true } } },
        });
        const totalStock = product?.inventory.reduce((s, inv) => s + inv.quantity, 0) ?? 0;
        return {
          id: row.productId,
          name: product?.name ?? "",
          sku: product?.sku ?? "",
          imageUrl: product?.imageUrl ?? null,
          revenue: Number(row._sum.total ?? 0),
          unitsSold: Number(row._sum.quantity ?? 0),
          stock: totalStock,
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error("Top products error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/recent-activity
router.get("/recent-activity", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [txns, orders] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, type: true, reason: true, createdAt: true },
      }),
      prisma.salesOrder.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, orderNumber: true, status: true, total: true, createdAt: true },
      }),
    ]);

    const activities = [
      ...txns.map((t) => ({
        id: t.id,
        type: "inventory",
        description: `Inventory ${t.type}: ${t.reason}`,
        timestamp: t.createdAt.toISOString(),
      })),
      ...orders.map((o) => ({
        id: o.id + 10000,
        type: "order",
        description: `Sales order ${o.orderNumber} — ${o.status} ($${Number(o.total).toFixed(2)})`,
        timestamp: o.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 15);

    res.json(activities);
  } catch (err) {
    console.error("Recent activity error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/low-stock
router.get("/low-stock", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const inventory = await prisma.inventory.findMany({
      include: {
        product: { select: { name: true, sku: true, reorderPoint: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { quantity: "asc" },
      take: 20,
    });

    const lowStock = inventory.filter((inv) => inv.quantity <= inv.product.reorderPoint);

    res.json(
      lowStock.map((inv) => ({
        id: inv.id,
        name: inv.product.name,
        sku: inv.product.sku,
        currentStock: inv.quantity,
        reorderPoint: inv.product.reorderPoint,
        warehouseName: inv.warehouse.name,
      }))
    );
  } catch (err) {
    console.error("Low stock error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
