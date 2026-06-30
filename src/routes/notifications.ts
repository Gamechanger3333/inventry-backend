import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/notifications
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { unread } = req.query as Record<string, string>;

    const notifications = await prisma.notification.findMany({
      where: unread === "true" ? { isRead: false } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json(
      notifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    console.error("List notifications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const n = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
    res.json({ ...n, createdAt: n.createdAt.toISOString() });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Mark read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/mark-all-read
router.post("/mark-all-read", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({ data: { isRead: true } });
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("Mark all read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/notifications/:id
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await prisma.notification.delete({ where: { id } });
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Delete notification error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
