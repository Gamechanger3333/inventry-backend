import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/reports/inventory
router.get("/inventory", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user!.organizationId;
    const products = await prisma.product.findMany({
      where: { organizationId },
      include: {
        category: { select: { name: true } },
        inventory: { select: { quantity: true } },
      },
    });

    let totalStock = 0;
    let stockValue = 0;
    let lowStockItems = 0;
    let outOfStockItems = 0;

    for (const p of products) {
      const qty = p.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
      totalStock += qty;
      stockValue += qty * Number(p.costPrice);
      if (qty === 0) outOfStockItems++;
      else if (qty <= p.reorderPoint) lowStockItems++;
    }

    // By category
    const categories = await prisma.category.findMany({
      where: { organizationId },
      include: {
        products: {
          include: { inventory: { select: { quantity: true } } },
        },
      },
    });

    const categoryBreakdown = categories.map((c) => {
      let catStock = 0;
      let catValue = 0;
      for (const p of c.products) {
        const qty = p.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
        catStock += qty;
        catValue += qty * Number(p.costPrice);
      }
      return {
        categoryName: c.name,
        productCount: c.products.length,
        totalStock: catStock,
        stockValue: Math.round(catValue * 100) / 100,
      };
    });

    res.json({
      totalProducts: products.length,
      totalStock,
      stockValue: Math.round(stockValue * 100) / 100,
      lowStockItems,
      outOfStockItems,
      categories: categoryBreakdown,
    });
  } catch (err) {
    console.error("Inventory report error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/sales
router.get("/sales", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user!.organizationId;
    const totals = await prisma.salesOrder.aggregate({
      _count: true,
      _sum: { total: true },
      where: { organizationId, status: "completed" },
    });

    const totalRevenue = Number(totals._sum.total ?? 0);
    const totalOrders = totals._count;

    // Top customers
    const topCustomersRaw = await prisma.salesOrder.groupBy({
      by: ["customerId"],
      _count: { id: true },
      _sum: { total: true },
      where: { organizationId, status: "completed" },
      orderBy: { _sum: { total: "desc" } },
      take: 10,
    });

    const topCustomers = await Promise.all(
      topCustomersRaw.map(async (row) => {
        const customer = await prisma.customer.findFirst({
          where: { id: row.customerId, organizationId },
          select: { name: true },
        });
        return {
          customerId: row.customerId,
          customerName: customer?.name ?? "",
          totalOrders: row._count.id,
          totalSpent: Number(row._sum.total ?? 0),
        };
      })
    );

    // Monthly breakdown (last 12 months)
    const now = new Date();
    const monthlyBreakdown = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("en", { month: "short", year: "2-digit" });
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

      const agg = await prisma.salesOrder.aggregate({
        _sum: { total: true },
        where: { organizationId, status: "completed", createdAt: { gte: start, lt: end } },
      });

      monthlyBreakdown.push({ label, value: Number(agg._sum.total ?? 0) });
    }

    res.json({
      totalRevenue,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      topCustomers,
      monthlyBreakdown,
    });
  } catch (err) {
    console.error("Sales report error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/reports/profit-loss
router.get("/profit-loss", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user!.organizationId;
    const now = new Date();
    const monthlyData = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("en", { month: "short", year: "2-digit" });
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

      const [revAgg, items] = await Promise.all([
        prisma.salesOrder.aggregate({
          _sum: { total: true },
          where: { organizationId, status: "completed", createdAt: { gte: start, lt: end } },
        }),
        prisma.salesOrderItem.findMany({
          where: {
            order: { organizationId, status: "completed", createdAt: { gte: start, lt: end } },
          },
          include: { product: { select: { costPrice: true } } },
        }),
      ]);

      const revenue = Number(revAgg._sum.total ?? 0);
      const cost = items.reduce(
        (sum, item) => sum + item.quantity * Number(item.product.costPrice),
        0
      );

      monthlyData.push({ label, revenue, cost, profit: revenue - cost });
    }

    const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0);
    const totalCost = monthlyData.reduce((s, m) => s + m.cost, 0);
    const grossProfit = totalRevenue - totalCost;

    res.json({
      totalRevenue,
      totalCost,
      grossProfit,
      grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
      monthlyData,
    });
  } catch (err) {
    console.error("P&L report error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
