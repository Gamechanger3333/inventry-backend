import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, requireRole, verifyCsrf, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/categories
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    res.json(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        color: c.color,
        productCount: c._count.products,
        createdAt: c.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("List categories error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/categories
router.post("/", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, color } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const cat = await prisma.category.create({
      data: { name, description, color, organizationId: req.user!.organizationId },
    });
    res.status(201).json({ ...cat, productCount: 0, createdAt: cat.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(400).json({ error: "Category name already exists" });
      return;
    }
    console.error("Create category error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/categories/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const cat = await prisma.category.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: { _count: { select: { products: true } } },
    });
    if (!cat) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...cat, productCount: cat._count.products, createdAt: cat.createdAt.toISOString() });
  } catch (err) {
    console.error("Get category error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/categories/:id
router.patch("/:id", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { name, description, color } = req.body;
    // Two-step ownership check: a bare `update({ where: { id } })` would
    // happily edit another organization's category if the id was guessed
    // (ids are sequential integers, easy to guess). findFirst scoped to
    // this user's organizationId first, then update by the verified id.
    const owned = await prisma.category.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const cat = await prisma.category.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
      },
      include: { _count: { select: { products: true } } },
    });
    res.json({ ...cat, productCount: cat._count.products, createdAt: cat.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update category error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/categories/:id
router.delete("/:id", requireAuth, verifyCsrf, requireRole("Inventory Manager"), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const result = await prisma.category.deleteMany({ where: { id, organizationId: req.user!.organizationId } });
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
    console.error("Delete category error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
