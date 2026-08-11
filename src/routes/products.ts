import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { getPagination, sendPaginated } from "../lib/pagination";

const router = Router();

function formatProduct(p: any) {
  const totalStock = p.inventory?.reduce((sum: number, inv: any) => sum + inv.quantity, 0) ?? 0;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    price: Number(p.price),
    costPrice: Number(p.costPrice),
    status: p.status,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    imageUrl: p.imageUrl,
    reorderPoint: p.reorderPoint,
    totalStock,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET /api/products
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, categoryId, status } = req.query as Record<string, string>;
    const pagination = getPagination(req);

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { sku: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      ...(categoryId && { categoryId: parseInt(categoryId) }),
      ...(status && { status }),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: { select: { name: true } },
          inventory: { select: { quantity: true } },
        },
        orderBy: { createdAt: "asc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.product.count({ where }),
    ]);

    sendPaginated(res, products.map(formatProduct), total, pagination);
  } catch (err) {
    console.error("List products error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/products
router.post("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, sku, description, price, costPrice, status, categoryId, imageUrl, reorderPoint } = req.body;
    if (!name || !sku) {
      res.status(400).json({ error: "Name and SKU are required" });
      return;
    }

    const product = await prisma.product.create({
      data: {
        name,
        sku,
        description,
        price: price ?? 0,
        costPrice: costPrice ?? 0,
        status: status || "active",
        categoryId: categoryId || null,
        imageUrl: imageUrl || null,
        reorderPoint: reorderPoint ?? 10,
      },
      include: {
        category: { select: { name: true } },
        inventory: { select: { quantity: true } },
      },
    });

    res.status(201).json(formatProduct(product));
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(400).json({ error: "SKU already exists" });
      return;
    }
    console.error("Create product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/products/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        inventory: {
          include: { warehouse: { select: { name: true } } },
        },
      },
    });

    if (!product) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json({
      ...formatProduct(product),
      inventoryByWarehouse: product.inventory.map((inv: any) => ({
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouse.name,
        quantity: inv.quantity,
      })),
    });
  } catch (err) {
    console.error("Get product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/products/:id
router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { name, sku, description, price, costPrice, status, categoryId, imageUrl, reorderPoint } = req.body;

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(sku !== undefined && { sku }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price }),
        ...(costPrice !== undefined && { costPrice }),
        ...(status !== undefined && { status }),
        ...(categoryId !== undefined && { categoryId }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(reorderPoint !== undefined && { reorderPoint }),
      },
      include: {
        category: { select: { name: true } },
        inventory: { select: { quantity: true } },
      },
    });

    res.json(formatProduct(product));
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/products/:id
router.delete("/:id", requireAuth, requireRole("Inventory Manager"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await prisma.product.delete({ where: { id } });
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Delete product error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
