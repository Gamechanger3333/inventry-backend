import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, verifyCsrf, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/notifications
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { unread } = req.query as Record<string, string>;
    const organizationId = req.user!.organizationId;

    const notifications = await prisma.notification.findMany({
      where: { organizationId, ...(unread === "true" && { isRead: false }) },
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
router.patch("/:id/read", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const organizationId = req.user!.organizationId;
    const owned = await prisma.notification.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!owned) {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
router.post("/mark-all-read", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // PRE-EXISTING BUG FIXED HERE: this previously had no `where` clause at
    // all, so any authenticated user marking "all read" silently marked
    // *every organization's* notifications as read platform-wide. Now
    // scoped to the caller's own organization.
    await prisma.notification.updateMany({
      where: { organizationId: req.user!.organizationId },
      data: { isRead: true },
    });
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    console.error("Mark all read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/notifications/:id
router.delete("/:id", requireAuth, verifyCsrf, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const result = await prisma.notification.deleteMany({ where: { id, organizationId: req.user!.organizationId } });
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
    console.error("Delete notification error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
